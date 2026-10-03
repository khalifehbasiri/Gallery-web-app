-- UUID-like random artwork IDs are tie breakers, not timestamps.
drop index gallery.artworks_recent;
drop index gallery.artworks_category;
drop index gallery.artworks_artist;
create index artworks_recent on gallery.artworks(created_at desc,id desc) where status='published';
create index artworks_category on gallery.artworks(category,created_at desc,id desc) where status='published';
create index artworks_artist on gallery.artworks(artist_id,created_at desc,id desc);
