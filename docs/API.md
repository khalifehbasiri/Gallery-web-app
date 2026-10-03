# REST API

All endpoints use JSON under `/api`, except multipart image uploads. Errors have the shape `{ "error": "message" }`. Authentication uses a signed JWT in an HttpOnly cookie and a revocable MongoDB session record. Mutation requests must originate from this application; local tools can make requests without an Origin header.

| Method       | Endpoint                                          | Purpose                                       | Access               |
| ------------ | ------------------------------------------------- | --------------------------------------------- | -------------------- |
| GET          | `/health`                                         | Process health and optional Redis state       | Public               |
| GET          | `/stats`                                          | Artwork/artist/workshop counts and categories | Public               |
| POST         | `/auth/register`                                  | Create a patron account                       | Public, rate limited |
| POST         | `/auth/login`                                     | Sign in and set the authentication cookie     | Public, rate limited |
| POST         | `/auth/logout`                                    | Revoke the current token and clear the cookie | Any visitor          |
| GET          | `/auth/me`                                        | Current public user or `null`                 | Any visitor          |
| GET          | `/artworks`                                       | Paginated artwork discovery                   | Public               |
| GET          | `/artworks/:id`                                   | Artwork, reviews, and artist summary          | Public               |
| POST         | `/artworks`                                       | Publish artwork with an image                 | Artist               |
| PUT / DELETE | `/artworks/:id/like`                              | Save / unsave an artwork                      | Signed in            |
| POST         | `/artworks/:id/reviews`                           | Add `{ "text": "..." }`                       | Signed in            |
| DELETE       | `/artworks/:id/reviews/:reviewId`                 | Remove a review                               | Review author        |
| GET          | `/artists/:id`                                    | Artist profile, artwork, and workshops        | Public               |
| PUT / DELETE | `/artists/:id/follow`                             | Follow / unfollow an artist                   | Signed in            |
| GET          | `/workshops`                                      | Paginated workshops                           | Public               |
| POST         | `/workshops`                                      | Create `{ "name", "goal", "weeks" }`          | Artist               |
| PUT          | `/artists/:id/workshops/:workshopId/registration` | Join a workshop once                          | Signed in            |
| GET          | `/account`                                        | Collection, follows, reviews, and studio      | Signed in            |
| PATCH        | `/account`                                        | Set `{ "role": "artist" }` or `"patron"`      | Signed in            |

Artwork list parameters: `page` (1–10000), `limit` (1–48, default 12), `search` (MongoDB text search), `category` (exact match), and `artist` (exact username). Workshop lists accept `page` and `limit`. Pages return `{ items, total, page, limit, pages }`. Unknown artwork filters are rejected; strings are validated before reaching database queries.

When Redis is enabled, `/stats` and anonymous `/artworks` responses use a shared cache with a default 60-second TTL. Their `X-Cache` header is `HIT`, `MISS`, or `BYPASS`. Signed-in artwork lists always bypass shared caching and use `Cache-Control: private, no-store`. Query validation happens before cache lookup. Relevant API writes invalidate discovery results before responding. Other endpoints are not cached.

`/health` returns `{ "status": "ok", "redis": "disabled" | "ready" | "unavailable" }`. Redis is optional, so an unavailable cache does not change liveness to a failure. This endpoint does not check MongoDB readiness or reveal connection details. See [Redis configuration and consistency](REDIS.md).

Registration/login accept `{ "username", "password" }`. Registration requires 8–256 password characters. Existing development seed passwords remain compatible. User responses expose only `id`, `username`, and `role`; tokens and password hashes never appear in response bodies.

Artwork uploads use multipart fields `title`, `year`, `category`, `medium`, `description`, and `image`. The API accepts PNG/JPEG/GIF/WebP signatures and limits uploads to 5 MB. It generates filenames and deletes the uploaded file if document creation fails.

MongoDB collections retain the legacy artwork and account structure. Existing user accounts, embedded relationships, and images are preserved. Review/workshop serializers support older records without UUIDs. Session cookies from the Pug application are replaced by JWT cookies, so users sign in again after migration.
