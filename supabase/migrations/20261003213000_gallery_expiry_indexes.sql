create index sessions_idle_expiry on gallery.sessions(idle_expires_at);
create index sessions_absolute_expiry on gallery.sessions(absolute_expires_at);
create index refresh_tokens_expiry on gallery.refresh_tokens(expires_at);
create index uploads_expiry_unused on gallery.uploads(expires_at) where used_at is null;
