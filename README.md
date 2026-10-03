# Gallery web app

An Express/Pug app for browsing artwork, following artists, liking artwork, posting reviews, uploading images, and creating or joining workshops. MongoDB stores accounts, artwork, and sessions.

## Setup

Requirements: Node.js 22.14 or newer, npm, and a running MongoDB server (local or hosted).

```sh
npm ci
```

Copy `.env.example` to `.env` and set `MONGODB_URI` and `SESSION_SECRET`. To generate a session secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The default database is `mongodb://127.0.0.1:27017/TP`; the default port is `3000`. If `SESSION_SECRET` is omitted in development, the app generates a temporary secret and existing sessions become invalid after a restart. Production requires a configured secret.

For a new development database, optionally add the demo data:

```sh
npm run seed
```

Seeding inserts missing accounts and artworks. Repeated runs preserve existing documents, passwords, reviews, likes, workshops, and sessions. It never drops the database and is disabled when `NODE_ENV=production`.

The original demo logins remain available: `khalifa` / `yes` for the patron account, and any seeded artist's name / `no` for an artist account. These are development fixtures with intentionally weak passwords. New registrations require at least eight characters.

Start the app:

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). For automatic restarts while editing, use `npm run dev`.

## Configuration

| Variable         | Purpose                                                    | Default                               |
| ---------------- | ---------------------------------------------------------- | ------------------------------------- |
| `MONGODB_URI`    | MongoDB connection string                                  | `mongodb://127.0.0.1:27017/TP`        |
| `PORT`           | HTTP port                                                  | `3000`                                |
| `SESSION_SECRET` | Signs session cookies                                      | Temporary random value in development |
| `NODE_ENV`       | Set to `production` for secure cookies and required secret | Development behavior                  |
| `TRUST_PROXY`    | Set to `1` behind one trusted reverse proxy                | `0`                                   |

Production mode expects HTTPS, usually through a reverse proxy. Images are stored in `uploads/`; preserve that directory alongside your MongoDB backups. Uploads and local environment files are ignored by Git.

## Project structure

- `server.js`: configuration, database/session-store setup, HTTP startup, and shutdown.
- `app.js`: Express middleware, static files, routing, and centralized errors.
- `routes/auth.js`: registration, login, legacy password upgrades, and logout.
- `routes/gallery.js`: account, artwork, search, follows, likes, reviews, uploads, and workshops.
- `lib/`: shared configuration, password hashing, and request validation.
- `userModel.js` and `galleriesModel.js`: database schemas using the existing collections and embedded data structure.
- `views/layout.pug` and `views/mixins/artwork.pug`: shared page layout and artwork/review controls.
- `public/`: styles, shared fetch/error handling, gallery interactions, and form scripts.
- `JSON/`: original demo artwork data.
- `database-initializer.js`: repeatable, non-destructive demo seeding.
- `test/`: integration tests using a separate temporary MongoDB instance and temporary upload directory.

## Checks

```sh
npm test
npm run check
npm run format:check
npm audit
```

Tests cover account validation, password upgrades, login/logout with MongoDB-backed sessions, authentication and artist permissions, isolated searches, repeated/concurrent likes and follows, review ownership, image validation and upload cleanup, workshop signup, page rendering, static script references, and repeatable seeding. The first test run may download a MongoDB test binary. Tests do not connect to the database in your `.env` file.

`npm run check` validates JavaScript syntax and compiles all Pug templates. `npm run format` formats JavaScript, CSS, Markdown, and configuration with Prettier. Pug templates and the original seed JSON are excluded from automatic formatting.

## Cleanup details

- Fixed the case-sensitive `UserModel.js` imports to use the actual `userModel.js` filename.
- Removed unused `fs` and `path` npm packages in favor of Node built-ins, the direct MongoDB dependency in favor of Mongoose's ObjectId API, and unused Morgan logging.
- Replaced `connect-mongodb-session` with `connect-mongo`, sharing the application's MongoDB connection. Updated Express, sessions, Mongoose, Multer, and Pug within their existing major versions and refreshed the lockfile.
- Removed the duplicate `readme.txt` and unrelated, unused office-supply fixtures in `vendors/`.
- Added Prettier, EditorConfig, and Git line-ending rules to keep future edits consistent across platforms.
- Replaced shared global search results with validated search criteria stored per session.
- Added explicit login and artist permission checks, allowed-field validation, missing-record responses, and centralized async error handling.
- New passwords use salted scrypt hashes. Existing plain-text passwords are upgraded after a successful login. Passwords are excluded from normal queries and removed from the account page. Login regenerates the session; logout destroys it.
- Registration defaults to a patron account and cannot inject follows, likes, workshops, or account type. Account-type switching uses the saved state rather than a client-supplied value.
- Likes and follows use conditional atomic updates to prevent duplicate entries. Unlike only decreases the count when the user actually had a like. New follow/like records store only the fields needed by the UI.
- New reviews have unique IDs. Removal checks the current author and artwork, including for older reviews without IDs.
- Uploads require an artist account, are limited to 5 MB, check PNG/JPEG/GIF/WebP signatures, receive generated filenames with proper extensions, and are removed if saving the artwork fails.
- Workshop creation validates its fields and initializes attendees on the server; repeated signups do not duplicate attendees.
- Consolidated repeated browser requests and gallery actions, and reused one layout and artwork template across pages. Added input labels, mobile viewport metadata, image alt text, and a responsive container while retaining the original visual style.

## Existing-data considerations

The cleanup does not rewrite your live database. Legacy passwords are upgraded as users log in; old embedded follow/like snapshots and historical like counts remain as stored. If legacy duplicate usernames exist, they need reconciliation before the unique username index can be created.

Artwork likes and reviews still update both user and artwork documents separately, matching the original data structure. Database transactions and a normalized relationship model would be a further change for production workloads; an interrupted database write can still leave those two documents inconsistent. Image signature checks validate the file type, not the complete image contents.
