-- Dedicated server identity; a deployment operator supplies its login password separately.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='gallery_backend') then
    create role gallery_backend nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;
grant usage on schema gallery to gallery_backend;
grant select,insert,update,delete on all tables in schema gallery to gallery_backend;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='gallery' loop
    execute format('create policy backend_access on gallery.%I to gallery_backend using (true) with check (true)',t);
  end loop;
end $$;
