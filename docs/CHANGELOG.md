# Modernization change log

## 1. Clean up and repair the original application

- Corrected case-sensitive model imports and removed unused packages, vendor fixtures, and duplicate documentation.
- Centralized configuration, validation, asynchronous errors, and reusable page/browser logic.
- Replaced global search results with isolated search criteria.
- Added salted password hashing, legacy password upgrades, session rotation/revocation, and protected account/artwork actions.
- Restricted registration fields, review deletion, and artist-only actions.
- Made repeated likes, follows, and workshop registrations safe against duplicates.
- Validated image signatures and upload sizes, generated filenames, and removed failed uploads.
- Made seeding repeatable without dropping data; added integration tests and formatting conventions.

This stage was committed before the architecture migration so the original cleanup remains independently reviewable.

## 2. Convert the backend to a TypeScript REST API

- Moved Node.js server code into `server/src/` and enabled strict TypeScript.
- Upgraded Express to version 5 and replaced rendered-page routes with JSON endpoints.
- Added frontend/backend contracts in `shared/contracts.ts` and documented every API endpoint.
- Replaced Express sessions with JWT cookies backed by revocable MongoDB auth-session records.
- Added safe response serializers, validated query filters, pagination, search indexes, origin checks, and login throttling.
- Retained existing MongoDB account/artwork collections and embedded relationships.
- Ported integration coverage to the REST API, including token replay, injection attempts, concurrent likes, and private-field exclusion.

## 3. Replace Pug with Angular

- Removed every Pug template and the old plain JavaScript page scripts/styles.
- Added a standalone Angular 21 client using TypeScript, RxJS, and NgRx SignalStore.
- Implemented gallery search/filtering, artwork details/reviews, artist profiles/follows, workshop discovery/registration, authentication, collections, artwork uploads, and workshop creation.
- Added lazy routes, reactive forms, guards, loading/error/empty states, responsive styling, and bundled artwork illustrations.
- Added state-management and review-form tests. Browser checks caught and corrected a CSP/style-loader conflict and an unbound review form.

## 4. Document and verify the portfolio project

- Added an isolated demo using temporary MongoDB and uploads, with reproducible credentials and local sample images.
- Replaced the old setup guide with development, build, demo, and environment instructions.
- Documented architecture, API behavior, resume wording, legacy-data compatibility, dependency advisories, and production limitations.
- Verified automated tests, strict builds, formatting, runtime audit, and desktop/mobile browser behavior.
