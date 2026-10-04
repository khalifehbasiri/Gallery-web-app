# CI/CD and release verification

`.github/workflows/ci.yml` runs for pull requests, pushes to main and manual dispatches. Actions have read-only repository permissions, pinned commit SHAs and Node 22.14.0. Dependabot proposes npm updates weekly and action updates monthly; updates still need review/tests.

**CI (continuous integration)** checks whether a change builds and behaves correctly. **CD (continuous delivery/deployment)** takes a passing main revision, builds a release, checks it on the hosting provider and publishes it. A green quality job and a red deployment job mean the code checks passed but the release failed; these are separate outcomes.

## Current deployment failure

The [October 4 run for `388cd7d`](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37229675880) passed its quality job, then stopped in **Require deployment configuration** with `Missing deployment setting: VERCEL_TOKEN`. No automatic deployment was attempted. Both `VERCEL_TOKEN` and `RENDER_DEPLOY_HOOK` are absent from repository and `production` environment secrets; the Vercel team/project variables are configured. Adding only the Vercel token would leave the Render hook as the next missing setting.

The live app was staged, checked and promoted manually through the signed-in Vercel CLI. Local Vercel login and local `.env` values are not automatically available to GitHub's fresh runner. Supabase Preview is a separate provider integration check; its success does not supply these deployment credentials.

## Quality gate

1. `npm ci` reproduces the lockfile.
2. `npm run format:check` checks formatting.
3. `npm test` exercises the API and Angular suites. PGlite isolates SQL state; a temporary real MongoDB 8 instance tests document storage/migration. An isolated Redis service on the runner supplies `TEST_REDIS_URL`, so live cache/queue/fence tests run without production credentials.
4. `npm run build` checks TypeScript, strict Angular templates and production bundle budgets.
5. `npm audit --omit=dev --audit-level=high` fails on high/critical runtime dependency findings. Development-only advisory debt is documented separately; the pipeline does not claim all dependencies are vulnerability-free.

Pull requests never receive production secrets. Production jobs run only on main after quality succeeds. No test suite uses the live application database or sends real email. The ephemeral Redis container belongs to the CI runner; application hosting does not require Docker.

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

Main jobs are serialized. The workflow checks the current main commit before staging/promotion and skips superseded revisions. Render's deploy hook is invoked with the tested commit reference only after checks; turn Gallery's Render Auto-Deploy off to prevent bypass. Its successful hook acknowledgement is not proof that a Render build reached `live`: inspect provider deployment status/logs. Do not alter unrelated Render services.

| GitHub setting               | Purpose                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Secret `VERCEL_TOKEN`        | Dedicated deployment token; scope to Gallery/team where supported, set an expiry and rotate before expiry |
| Variable `VERCEL_ORG_ID`     | Linked Vercel team identity                                                                               |
| Variable `VERCEL_PROJECT_ID` | Gallery project identity                                                                                  |
| Secret `RENDER_DEPLOY_HOOK`  | Gallery notification service's secret hook URL                                                            |

Credentials never belong in Git, workflow literals, chat or artifacts. The CLI's short-lived OAuth token/refresh secret are not suitable CI deployment credentials. All deployment settings are checked before staging; missing credentials deliberately fail rather than report a successful deployment. Vercel rejected programmatic dedicated-token creation through the CLI; an account owner must create/install it. Main branch protection requires the GitHub Actions quality check on an up-to-date revision and forbids force pushes/deletion. Repository administrators retain their override for operator releases; this is not an enforced prohibition on every manual deployment.

## Enable automatic deployment

1. Create a dedicated deployment token at [Vercel account tokens](https://vercel.com/account/tokens), with access to Gallery's team and an expiry you will rotate before it lapses. This is a deployment credential, separate from the application's JWT signing secret and local CLI login. See [Vercel CLI authentication](https://vercel.com/docs/cli).
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

The [first hosted quality run](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37220306198/job/111489118347) passed its then-current 65 API and 13 Angular tests with no skips, formatting, production build and runtime audit (zero findings). The [community-data revision's quality job](https://github.com/khalifehbasiri/Gallery-web-app/actions/runs/37229675880/job/111516521038) passed the expanded 78 backend and 17 Angular tests. Its deployment job failed at the missing credentials described above; do not claim the automatic release path is working until those settings are installed and a full run succeeds.

The additive schema migration was applied and the security advisor returned no findings. A manually staged/promoted Vercel release passed hosted signup, private identity, opt-out, export, disposable-account deletion, both demo logins and all 30 catalog entries. Controlled database challenge fixtures exercised verification, reset, single-use rejection and old-session revocation without sending email. This validates hosted token handling, not real inbox delivery. Existing data remained intact after test-account cleanup.

## Schema and rollback

Database migrations are reviewed/applied independently before releasing code that needs them. The workflow does not run migrations, seed production, or use elevated database credentials. Additive email/lifecycle columns preserve existing logins/demo accounts. Check the migration history and security advisor after applying them. For rollback, point Vercel at the previous verified artifact and inspect database compatibility; never blindly reverse deletion or restore an old security/cache epoch.

After release, verify signup validation, both demo logins, private email/settings, recovery, export/deletion with an owned disposable account, CSP/browser errors and provider logs. Real recovery email verification additionally requires the configured sender. See [Vercel's deployment workflow](https://vercel.com/docs/deployments) and [GitHub's action security guidance](https://docs.github.com/en/actions/reference/security/secure-use).
