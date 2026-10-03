-- Durable notification outbox: commit business state and notification intent together.
create table gallery.notification_preferences (
  user_id text primary key references gallery.users(id) on delete cascade,
  email text not null check(length(email)<=254),
  version uuid not null,
  enabled boolean not null default false,
  verified_at timestamptz,
  verification_hash text,
  verification_expires_at timestamptz,
  verification_attempts integer not null default 0,
  requested_at timestamptz not null default now()
);
create table gallery.notification_outbox (
  id uuid primary key,
  user_id text not null references gallery.users(id) on delete cascade,
  preference_version uuid not null,
  kind text not null check(kind in ('verify','like')),
  dedupe_key text not null unique,
  payload text not null,
  status text not null default 'pending' check(status in ('pending','processing','done','cancelled','dead')),
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index notification_due on gallery.notification_outbox(available_at,created_at) where status='pending';
create index notification_leases on gallery.notification_outbox(lease_until) where status='processing';
create index notification_recipient on gallery.notification_outbox(user_id,created_at);
create index notification_provider on gallery.notification_outbox(provider_id) where provider_id is not null;
create table gallery.email_suppressions (
  email text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);
create table gallery.email_budget (
  period text primary key,
  attempts integer not null default 0
);
create table gallery.email_webhooks (
  id text primary key,
  created_at timestamptz not null default now()
);
create table gallery.email_verification_limits (
  address_hash text primary key,
  window_started timestamptz not null default now(),
  attempts integer not null default 1
);
do $$ declare t text; begin
  foreach t in array array['notification_preferences','notification_outbox','email_suppressions','email_budget','email_webhooks','email_verification_limits'] loop
    execute format('alter table gallery.%I enable row level security',t);
    execute format('revoke all on gallery.%I from public',t);
    if exists(select 1 from pg_roles where rolname='anon') then execute format('revoke all on gallery.%I from anon',t); end if;
    if exists(select 1 from pg_roles where rolname='authenticated') then execute format('revoke all on gallery.%I from authenticated',t); end if;
    execute format('grant select,insert,update,delete on gallery.%I to gallery_backend',t);
    execute format('create policy backend_access on gallery.%I to gallery_backend using (true) with check (true)',t);
  end loop;
end $$;
-- Processor cannot read password hashes, sessions, refresh tokens, or artwork stores.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='gallery_mail_worker') then
    create role gallery_mail_worker nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;
grant usage on schema gallery to gallery_mail_worker;
grant select,update on gallery.notification_outbox to gallery_mail_worker;
grant select on gallery.notification_preferences,gallery.email_suppressions to gallery_mail_worker;
grant select,insert,update on gallery.email_budget to gallery_mail_worker;
do $$ declare t text; begin
  foreach t in array array['notification_preferences','notification_outbox','email_suppressions','email_budget'] loop
    execute format('create policy mail_worker_access on gallery.%I to gallery_mail_worker using (true) with check (true)',t);
  end loop;
end $$;
