# CI/CD and release verification

`.github/workflows/ci.yml` runs for pull requests, pushes to main and manual dispatches. Actions have read-only repository permissions and pinned commit SHAs. Checkout v7.0.1 and setup-node v7.0.0 use Node 24 for their own action runtime; setup-node still installs Node 22.14.0 for this application's commands. Updating the Actions removes their Node 20 deprecation warnings without changing the application's supported Node version. Dependabot proposes npm updates weekly and action updates monthly; updates still need review/tests.

**CI (continuous integration)** checks whether a change builds and behaves correctly. **CD (continuous delivery/deployment)** takes a passing main revision, builds a release, checks it on the hosting provider and publishes it. A green quality job and a red deployment job mean the code checks passed but the release failed; these are separate outcomes.

## Deployment troubleshooting history

The [first community-data run](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37229675880) passed quality but stopped because deployment secrets were missing. Both `VERCEL_TOKEN` and `RENDER_DEPLOY_HOOK` are now installed in GitHub's `production` environment, and the team/project variables match the working local Vercel link.

The [subsequent manual run](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37230883635) also passed quality, then failed at `vercel pull` with **Could not retrieve Project Settings**. Its Vercel token was scoped only to Gallery. The CLI also reads owning-team metadata, which that token cannot access; deleting the local `.vercel` directory does not change the token's permissions. This matches a [reported project-token limitation](https://github.com/vercel/vercel/issues/17506). The production secret was replaced with a token scoped to Gallery's owning team. The workflow now checks project and team access separately and reports only HTTP status/actionable instructions, never token values or response bodies.

After installing the team-scoped token, [the next run](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37231730206) passed quality, permission checks, Vercel build/deployment and both staged API smoke checks, but promotion reported **Deployment belongs to a different team**. Every Vercel command now explicitly receives `--scope="$VERCEL_ORG_ID"`, including promotion; the linked project file alone does not consistently establish promotion's team context. This matches a [reported promotion scope issue](https://github.com/vercel/vercel/issues/11712). The [corrected full run](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37231980502) passed both quality and deployment jobs, including promotion and the Render hook.

Earlier releases were staged, checked and promoted manually through the signed-in Vercel CLI; the corrected workflow now performs those steps automatically. Local Vercel login and local `.env` values are not automatically available to GitHub's fresh runner. Supabase Preview is a separate provider integration check; its success does not supply these deployment credentials.

## Quality gate

1. `npm ci` reproduces the lockfile.
2. `npm run format:check` checks formatting.
3. `npm test` exercises the API and Angular suites. PGlite isolates SQL state; a temporary real MongoDB 8 instance tests document storage/migration. An isolated Redis service on the runner supplies `TEST_REDIS_URL`, so live cache/queue/fence tests run without production credentials.
4. `npm run build` checks TypeScript, strict Angular templates and production bundle budgets.
5. `npm audit --omit=dev --audit-level=high` fails on high/critical runtime dependency findings. Development-only advisory debt is documented separately; the pipeline does not claim all dependencies are vulnerability-free.

Pull requests never receive production secrets. Production jobs run only on main after quality succeeds. No test suite uses the live application database or sends real email. The ephemeral Redis container belongs to the CI runner; application hosting does not require Docker.

### Docker's role in this pipeline

The quality job's `services.redis` block is an actual Docker service container using `redis:7.4.2`. GitHub starts it on the Ubuntu runner, waits for its `redis-cli ping` health check and exposes port 6379 to the Node.js tests through `TEST_REDIS_URL`. A fresh container gives every job disposable Redis state; GitHub destroys it when that job completes. Tests use namespaced keys and exercise expiry/invalidation, cross-instance revocation fences and competing notification consumers against real Redis. See [GitHub's Docker service-container documentation](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers).

The Redis version tag is fixed, but not an immutable digest. Updating it requires reviewing Redis compatibility and rerunning integration checks. CI SQL and MongoDB have different test lifecycles: PGlite provides isolated SQL, while mongodb-memory-server starts a temporary MongoDB binary. The application build/tests run directly on the runner, not in an application container.

Docker supports **CI** here by supplying a reproducible test dependency. The **CD** job depends on the entire quality job succeeding, but publishes Vercel build output and invokes Render's Node.js service hook; it does not build or publish an application Docker image. The Redis test container is never promoted to production. Production caching continues to use Upstash. See the README's [Docker explanation](../README.md#docker-isolated-redis-integration-tests) for the larger-company image/registry/orchestrator pattern and this project's implementation boundary.

The current suite includes 78 backend and 17 Angular tests:

| Area                    | Examples of behavior tested                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication/security | Strict HttpOnly cookies, CSRF rejection, JWT denial, refresh rotation/replay, logout, session ownership and expiry                                                    |
| Account lifecycle       | Required email/terms, private identity, notification opt-out, single-use password reset, export, deletion and retention                                               |
| Gallery/business rules  | Search/filter/pagination, role and ownership checks, duplicate likes, transactional counters, comments, follows and workshop enrollment                               |
| MongoDB/publication     | Database validation, unique IDs, copy verification, conflicting documents and recovery from interrupted publication                                                   |
| Redis/feeds             | Cache expiry/invalidation, concurrent misses, private flag isolation, outages, chronological Following, Explore pagination and revocation races                       |
| Notifications           | Durable outbox intent, leases/retries, idempotency, consent, verification limits, suppression, webhook signatures and delivery budgets; sender calls are test doubles |
| Demo data/images        | Repeatable seeding, preserving existing data, collision/rollback recovery, no sample email jobs, public-source image digests and bounds                               |
| Angular                 | Authentication/refresh state, reactive search/feed state, optimistic-like rollback, comment forms, lifecycle forms and image attribution/error display                |

The build also checks strict TypeScript and Angular templates and enforces configured bundle budgets. Formatting checks consistency; it is not a linter or proof that the logic is correct. These are automated unit/integration/component checks, not a full cross-browser end-to-end suite, accessibility certification, penetration test or load benchmark.

## Deployment gate

Production jobs use a GitHub `production` environment and repository-configured credentials. Vercel automatic Git deployments are disabled in `vercel.json`, avoiding a separate path that could publish before checks finish. The workflow pins Vercel CLI 50.5.0, retrieves server-side production configuration, builds Vercel output, stages with `--prebuilt --prod --skip-domain`, checks application liveness and gallery response shape using `vercel curl`, then promotes that same artifact. Smoke checks are basic dependency/shape checks, not exhaustive end-to-end verification.

Main jobs are serialized. The workflow checks the current main commit before staging/promotion and skips superseded revisions. Render's deploy hook is invoked with the tested commit reference only after checks. A hook with a commit `ref` automatically disables Render Auto-Deploy; Gallery's service was verified as Off after the corrected run. Its successful hook acknowledgement is not proof that a Render build reached `live`: inspect provider deployment status/logs. Do not alter unrelated Render services.

| GitHub setting               | Purpose                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Secret `VERCEL_TOKEN`        | Dedicated deployment token scoped to Gallery's owning team; set an expiry and rotate before expiry |
| Variable `VERCEL_ORG_ID`     | Linked Vercel team identity                                                                        |
| Variable `VERCEL_PROJECT_ID` | Gallery project identity                                                                           |
| Secret `RENDER_DEPLOY_HOOK`  | Gallery notification service's secret hook URL                                                     |

Credentials never belong in Git, workflow literals, chat or artifacts. The CLI's short-lived OAuth token/refresh secret are not suitable CI deployment credentials. All deployment settings are checked before staging; missing credentials deliberately fail rather than report a successful deployment. Vercel rejected programmatic dedicated-token creation through the CLI; an account owner must create/install it. Main branch protection requires the GitHub Actions quality check on an up-to-date revision and forbids force pushes/deletion. Repository administrators retain their override for operator releases; this is not an enforced prohibition on every manual deployment.

## Enable automatic deployment

1. Create a dedicated deployment token at [Vercel account tokens](https://vercel.com/account/tokens), scoped to **Khalifeh Basiri's projects**, Gallery's owning team, and set an expiry you will rotate before it lapses. Do not select only the Gallery project for this CLI pull/build workflow: it also requires team metadata access. A team-scoped token has broader permissions over that team's resources, so reserve it for the protected production deployment job and rotate it. This credential is separate from the application's JWT signing secret and local CLI login. See [Vercel CLI authentication](https://vercel.com/docs/cli).
2. Open the **Gallery notification service** in Render, then **Settings → Deploy Hook**. Copy its secret URL. Confirm this is Gallery's service, not another application. Set that service's **Auto-Deploy** to **Off** if you want every production release to go through the GitHub quality gate. See [Render deploy hooks](https://render.com/docs/deploy-hooks) and [auto-deploy settings](https://render.com/docs/deploys).
3. In [Gallery's GitHub repository settings](https://github.com/khalifehbasiri/Gallery-web-app/settings/environments), open **Environments → production → Environment secrets** and add `VERCEL_TOKEN` and `RENDER_DEPLOY_HOOK`. Repository Actions secrets also work, but use one location consistently. The existing `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` repository variables can stay as configured. See [GitHub secret setup](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
4. Open [Actions → Quality and deployment](https://github.com/khalifehbasiri/Gallery-web-app/actions/workflows/ci.yml), select **Run workflow**, choose **main**, then start the run. Review both jobs. Verify the Vercel release is promoted and the Render deployment reaches `live`; a successful deploy-hook request alone does not prove the processor build succeeded.

The GitHub CLI can prompt for secrets without placing their values in shell history:

```sh
gh secret set VERCEL_TOKEN --env production
gh secret set RENDER_DEPLOY_HOOK --env production
gh workflow run ci.yml --ref main
```

Use a new run on current main after changing code. Re-running the failed job is appropriate when only credentials/configuration changed and that run's revision is still current main. Superseded runs skip publication by design. See [manually running workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## Everyday use

1. Make changes on a branch and open a pull request. The quality job runs; the production deployment job is skipped. Fix failures before merging. Dependabot update PRs go through the same checks.
2. Merge into `main`. GitHub runs the quality gate again for that exact main revision. Once credentials are configured, successful checks allow staging, smoke checks and promotion, followed by the Render hook.
3. To diagnose a red check, click **Details** or open its Actions run, select the failed job and expand the first failed step. Fix code/build failures in a new commit; fix missing deployment configuration in provider/GitHub settings. Do not bypass a failed test to deploy.
4. For a manual release of current main, use **Actions → Quality and deployment → Run workflow**. It runs the same checks and deployment steps as a main push.

Useful CLI commands:

```sh
gh run list --workflow ci.yml --limit 5
gh run view RUN_ID --log-failed
gh run watch RUN_ID
gh run rerun RUN_ID --failed
```

Before pushing, run `npm run format:check`, `npm test`, `npm run build` and `npm audit --omit=dev --audit-level=high`. Local live-Redis tests need the ignored `.env.test` configuration described in the README; GitHub supplies an isolated Redis instance automatically. On resource-constrained Windows machines, backend tests can run with `node --env-file-if-exists=.env.test --import tsx --test --test-concurrency=2 test/*.test.ts`.

This workflow does not create provider accounts, provision hosting, seed production, migrate its databases or back them up. Runtime database/email/storage credentials stay in the hosting environments. Installing the two GitHub deployment secrets does not configure public Resend email delivery.

## Verified release: October 4, 2026

The [first hosted quality run](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37220306198/job/111489118347) passed its then-current 65 API and 13 Angular tests with no skips, formatting, production build and runtime audit (zero findings). The [community-data revision's quality job](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37229675880/job/111516521038) passed the expanded 78 backend and 17 Angular tests. The [corrected automatic release](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37231980502) passed the expanded quality gate and both deployment stages: Vercel build, staged health/catalog checks and promotion, followed by the Render hook for that exact commit. Render deployment `dep-db1bdec9v7es73epvqng` was separately verified as `live` at commit `ca40012`, with Auto-Deploy Off and the Free plan retained. The Actions Node 20 deprecation annotations were absent after upgrading checkout/setup-node; the app runtime remains Node 22.

The additive schema migration was applied and the security advisor returned no findings. A manually staged/promoted Vercel release passed hosted signup, private identity, opt-out, export, disposable-account deletion, both demo logins and all 30 catalog entries. Controlled database challenge fixtures exercised verification, reset, single-use rejection and old-session revocation without sending email. This validates hosted token handling, not real inbox delivery. Existing data remained intact after test-account cleanup.

## Schema and rollback

Database migrations are reviewed/applied independently before releasing code that needs them. The workflow does not run migrations, seed production, or use elevated database credentials. Additive email/lifecycle columns preserve existing logins/demo accounts. Check the migration history and security advisor after applying them. For rollback, point Vercel at the previous verified artifact and inspect database compatibility; never blindly reverse deletion or restore an old security/cache epoch.

After release, verify signup validation, both demo logins, private email/settings, recovery, export/deletion with an owned disposable account, CSP/browser errors and provider logs. Real recovery email verification additionally requires the configured sender. See [Vercel's deployment workflow](https://vercel.com/docs/deployments) and [GitHub's action security guidance](https://docs.github.com/en/actions/reference/security/secure-use).
