-- Private schema: the browser never queries these tables directly.
create schema if not exists gallery;
revoke all on schema gallery from public;

create table gallery.users (
  id text primary key check (id ~ '^[a-f0-9]{24}$'),
  username text not null unique check (length(username) between 1 and 80),
  password_hash text not null,
  role text not null default 'patron' check (role in ('patron','artist')),
  created_at timestamptz not null default now()
);
create index users_role on gallery.users(role,id);

-- Derived search projection and publication registry. Full documents live in Firestore.
create table gallery.artworks (
  id text primary key check (id ~ '^[a-f0-9]{24}$'),
  artist_id text not null references gallery.users(id),
  title text not null unique,
  year text not null,
  category text not null,
  medium text not null,
  description_preview text not null,
  image_url text not null,
  search_document tsvector not null,
  status text not null default 'pending' check (status in ('pending','published')),
  like_count integer not null default 0 check (like_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  created_at timestamptz not null default now()
);
create index artworks_search on gallery.artworks using gin(search_document);
create index artworks_recent on gallery.artworks(id desc) where status='published';
create index artworks_category on gallery.artworks(category,id desc) where status='published';
create index artworks_artist on gallery.artworks(artist_id,id desc);

create table gallery.likes (
  user_id text not null references gallery.users(id),
  artwork_id text not null references gallery.artworks(id),
  primary key(user_id,artwork_id)
);
create index likes_artwork on gallery.likes(artwork_id);
create table gallery.follows (
  user_id text not null references gallery.users(id),
  artist_id text not null references gallery.users(id),
  primary key(user_id,artist_id), check (user_id <> artist_id)
);
create index follows_artist on gallery.follows(artist_id);
create table gallery.reviews (
  id text primary key,
  user_id text not null references gallery.users(id),
  artwork_id text not null references gallery.artworks(id),
  text text not null check (length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index reviews_artwork on gallery.reviews(artwork_id,created_at desc,id);
create index reviews_user on gallery.reviews(user_id,created_at desc);
create table gallery.workshops (
  id text primary key,
  artist_id text not null references gallery.users(id),
  name text not null,
  goal text not null,
  weeks integer not null check (weeks between 1 and 9999),
  created_at timestamptz not null default now(),
  unique(artist_id,name)
);
create index workshops_recent on gallery.workshops(created_at desc,id);
create table gallery.enrollments (
  user_id text not null references gallery.users(id),
  workshop_id text not null references gallery.workshops(id),
  primary key(user_id,workshop_id)
);
create index enrollments_workshop on gallery.enrollments(workshop_id);

create table gallery.sessions (
  id uuid primary key,
  user_id text not null references gallery.users(id),
  created_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  check (idle_expires_at <= absolute_expires_at)
);
create index sessions_user on gallery.sessions(user_id,created_at desc);
create table gallery.refresh_tokens (
  hash text primary key check (hash ~ '^[a-f0-9]{64}$'),
  session_id uuid not null references gallery.sessions(id),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index refresh_sessions on gallery.refresh_tokens(session_id);
create table gallery.token_denials (
  jti uuid primary key,
  user_id text not null references gallery.users(id),
  expires_at timestamptz not null
);
create index token_denials_expiry on gallery.token_denials(expires_at);
create table gallery.uploads (
  id uuid primary key,
  user_id text not null references gallery.users(id),
  path text not null unique,
  content_type text not null,
  max_bytes integer not null check (max_bytes between 1 and 5242880),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index uploads_user on gallery.uploads(user_id,expires_at);

-- No Data API grants or permissive policies. Backend-only credentials access this schema.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='gallery' loop
    execute format('alter table gallery.%I enable row level security', t);
    execute format('revoke all on gallery.%I from public', t);
  end loop;
end $$;
