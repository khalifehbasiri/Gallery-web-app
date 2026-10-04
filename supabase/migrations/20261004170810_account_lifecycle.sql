-- Email is private account data; existing/demo accounts may initially have no address.
alter table gallery.users add column email text;
alter table gallery.users add column email_verified_at timestamptz;
alter table gallery.users add column terms_version text;
alter table gallery.users add column terms_accepted_at timestamptz;
alter table gallery.users add column deletion_requested_at timestamptz;
alter table gallery.users add constraint users_email_format check(email is null or (length(email)<=254 and email=lower(email) and email like '%@%.%'));
create unique index users_email_unique on gallery.users(email) where email is not null;
-- Preserve an already verified, unambiguous legacy notification address.
update gallery.users u set email=p.email,email_verified_at=p.verified_at from gallery.notification_preferences p
where u.id=p.user_id and p.verified_at is not null and u.username not in ('demo','Maya Laurent')
and (select count(*) from gallery.notification_preferences x where x.email=p.email)=1;
alter table gallery.notification_preferences add column consent_at timestamptz;
alter table gallery.notification_preferences add column consent_version text;
update gallery.notification_preferences set consent_at=requested_at,consent_version='legacy-notification-opt-in' where enabled;

create table gallery.account_challenges (
  id uuid primary key,
  user_id text not null references gallery.users(id) on delete cascade,
  email text not null,
  kind text not null check(kind in ('account-verify','password-reset')),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index account_challenges_user on gallery.account_challenges(user_id,kind,created_at);
create index account_challenges_expiry on gallery.account_challenges(expires_at);
alter table gallery.notification_outbox drop constraint notification_outbox_kind_check;
alter table gallery.notification_outbox add constraint notification_outbox_kind_check check(kind in ('verify','like','account-verify','password-reset'));
create table gallery.account_deletions (
  user_id text primary key references gallery.users(id) on delete cascade,
  artwork_ids jsonb not null,
  image_paths jsonb not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  image_paths_final jsonb not null default '[]',
  final_pass boolean not null default false,
  not_before timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['account_challenges','account_deletions'] loop
    execute format('alter table gallery.%I enable row level security',t);
    execute format('revoke all on gallery.%I from public',t);
    execute format('grant select,insert,update,delete on gallery.%I to gallery_backend',t);
    execute format('create policy backend_access on gallery.%I to gallery_backend using (true) with check (true)',t);
  end loop;
end $$;
grant select(id,email,expires_at,used_at) on gallery.account_challenges to gallery_mail_worker;
create policy mail_worker_access on gallery.account_challenges to gallery_mail_worker using (true);
create function gallery.prevent_retired_publication() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='published' then
    perform 1 from gallery.users where id=new.artist_id and deletion_requested_at is null for share;
    if not found then raise exception 'Account is unavailable' using errcode='23514'; end if;
  end if;
  return new;
end $$;
revoke all on function gallery.prevent_retired_publication() from public;
create trigger active_publication before update of status on gallery.artworks for each row execute function gallery.prevent_retired_publication();

-- Serialize new user-owned writes against retirement, including requests already in flight.
create function gallery.require_active_user() returns trigger language plpgsql set search_path='' as $$
declare owner_id text; begin
  owner_id:=to_jsonb(new)->>TG_ARGV[0];
  perform 1 from gallery.users where id=owner_id and deletion_requested_at is null for share;
  if not found then raise exception 'Account is unavailable' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function gallery.require_active_user() from public;
do $$ declare t text; begin
  foreach t in array array['likes','reviews','follows','enrollments','uploads','sessions'] loop
    execute format('create trigger active_account before insert on gallery.%I for each row execute function gallery.require_active_user(''user_id'')',t);
  end loop;
  foreach t in array array['artworks','workshops'] loop
    execute format('create trigger active_account before insert on gallery.%I for each row execute function gallery.require_active_user(''artist_id'')',t);
  end loop;
end $$;
