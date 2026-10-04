# CI/CD and release verification

`.github/workflows/ci.yml` runs for pull requests, pushes to main and manual dispatches. Actions have read-only repository permissions, pinned commit SHAs and Node 22.14.0. Dependabot proposes npm updates weekly and action updates monthly; updates still need review/tests.

## Quality gate

1. `npm ci` reproduces the lockfile.
2. `npm run format:check` checks formatting.
3. `npm test` exercises the API and Angular suites. PGlite isolates SQL state; a temporary real MongoDB 8 instance tests document storage/migration. An isolated Redis service on the runner supplies `TEST_REDIS_URL`, so live cache/queue/fence tests run without production credentials.
4. `npm run build` checks TypeScript, strict Angular templates and production bundle budgets.
5. `npm audit --omit=dev --audit-level=high` fails on high/critical runtime dependency findings. Development-only advisory debt is documented separately; the pipeline does not claim all dependencies are vulnerability-free.

Pull requests never receive production secrets. Production jobs run only on main after quality succeeds. No test suite uses the live application database or sends real email. The ephemeral Redis container belongs to the CI runner; application hosting does not require Docker.

## Deployment gate

Production jobs use a GitHub `production` environment and repository-configured credentials. Vercel automatic Git deployments are disabled in `vercel.json`, avoiding a separate path that could publish before checks finish. The workflow pins Vercel CLI 50.5.0, retrieves server-side production configuration, builds Vercel output, stages with `--prebuilt --prod --skip-domain`, checks application liveness and gallery response shape using `vercel curl`, then promotes that same artifact. Smoke checks are basic dependency/shape checks, not exhaustive end-to-end verification.

Main jobs are serialized. The workflow checks the current main commit before staging/promotion and skips superseded revisions. Render's deploy hook is invoked with the tested commit reference only after checks; turn Gallery's Render Auto-Deploy off to prevent bypass. Its successful hook acknowledgement is not proof that a Render build reached `live`: inspect provider deployment status/logs. Do not alter unrelated Render services.

| GitHub setting               | Purpose                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Secret `VERCEL_TOKEN`        | Dedicated deployment token; scope to Gallery/team where supported, set an expiry and rotate before expiry |
| Variable `VERCEL_ORG_ID`     | Linked Vercel team identity                                                                               |
| Variable `VERCEL_PROJECT_ID` | Gallery project identity                                                                                  |
| Secret `RENDER_DEPLOY_HOOK`  | Gallery notification service's secret hook URL                                                            |

Credentials never belong in Git, workflow literals, chat or artifacts. The CLI's short-lived OAuth token/refresh secret are not suitable CI deployment credentials. Missing deploy credentials deliberately fail configuration checks rather than report a successful deployment. Vercel rejected programmatic dedicated-token creation through the CLI; an account owner must create/install it. Repository branch protection is a separate control: require the quality check for PR merges and restrict direct pushes when ready for a team workflow.

## Schema and rollback

Database migrations are reviewed/applied independently before releasing code that needs them. The workflow does not run migrations, seed production, or use elevated database credentials. Additive email/lifecycle columns preserve existing logins/demo accounts. Check the migration history and security advisor after applying them. For rollback, point Vercel at the previous verified artifact and inspect database compatibility; never blindly reverse deletion or restore an old security/cache epoch.

After release, verify signup validation, both demo logins, private email/settings, recovery, export/deletion with an owned disposable account, CSP/browser errors and provider logs. Real recovery email verification additionally requires the configured sender. See [Vercel's deployment workflow](https://vercel.com/docs/deployments) and [GitHub's action security guidance](https://docs.github.com/en/actions/reference/security/secure-use).
