-- A persistent shuffled ordering allows bounded index seeks instead of random() sorting.
-- MD5 here is an ordering key, never a credential digest.
alter table gallery.artworks add column explore_key text generated always as (md5(id)) stored;
create index artworks_explore on gallery.artworks(explore_key,id) where status='published';
