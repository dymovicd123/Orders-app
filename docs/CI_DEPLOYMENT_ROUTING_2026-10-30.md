# Safe Main/Branch2 CI/CD routing (2026-10-30)

This is a candidate on top of current Main CI PR #640. No Cloudflare or D1 action was taken.

- The native Cloudflare build monitor remains a **read-only monitor** of native builds and reports a failure for missing/skipped/failed builds. The previous automatic direct-production `npm run deploy` fallback is deliberately removed. Absence of a build is a release problem requiring an **explicitly reviewed deployment**, never a hidden retry through a second publisher.
- Only runtime-relevant Main/Branch2 pushes invoke the monitor. Changes exclusively to `docs/`, test scripts or workflow definitions no longer trigger the GitHub monitor; note that **Cloudflare's own build triggers are external and must be reviewed independently**. Dependency changes remain runtime relevant by design.
- Branch2 monitor verifies the October 27 isolated mirror ID. Production monitor enforces the production Worker and D1 identity separately.
- Old dated Staff and KPI selective release workflows no longer react to every Main PR or silently deploy from unrelated Main pushes; they remain accessible as historical source and scoped verification. A dated finance gate no longer reacts to `package.json` security-only updates. The current Main quality gate remains the primary mandatory contract.
- This change **does not archive all older production migration workflows**. Some can still mutate production on matching pushes; they must be inventoried and individually gated with evidence before merging the workflow-hygiene candidate. Also evaluate Cloudflare auto-build rules and required-status branch protections.

**Do not merge until completed workflow inventory, verification and explicit deployment review.**


## Live verification of independent Cloudflare deploy triggers (2026-10-30)

Source: [GET-only inspection #41085684155](https://github.com/dymovicd123/Orders-app/actions/runs/41085684155); issue [#656](https://github.com/dymovicd123/Orders-app/issues/656). This audit did not change Cloudflare settings.

- `orders-app` production trigger: `branch_includes=["main"]`, `path_includes=["*"]`, deploy mode **wrangler deploy**. Its non-main preview trigger uses **versions upload**.
- `orders-app-branch2` trigger: `branch_includes=["branch2"]`, `path_includes=["*"]`, deploy mode **wrangler deploy**.
- Consequently a docs-only/workflows-only push to main or branch2 may still publish a Worker even after GitHub's monitor has become read-only. This is **not fixed by this PR**.
- Cloudflare's documented build watch paths are advisory filtering, **not a hard manual release gate**: pushes with zero changed files, 3,000+ changed files or 20+ commits bypass path matching and build anyway. Do not rely on `path_excludes=['docs/*']` to guarantee an approved release.

### Recommended two-phase release design — decision pending, no settings changed

1. With separate explicit approval, switch the **Branch2 native** deploy command from `wrangler deploy` to `wrangler versions upload`, retaining the same Worker, isolated D1 mirror, branch and build configuration. Only the *deploy_command* should change. This creates a version without sending traffic to it; the version must be tested with its version URL and exact SHA. Verify Worker assets, API auth, D1 binding, current stock, returns, exchanges and manager access on a restricted test version. Do not assume preview/version URLs safely simulate all authenticated workflows without proof.
2. Confirm via new GET-only API inspection that Branch2's native trigger now has upload-only mode. Test with an approved isolated harmless change; verify current production-like Branch2 traffic remains on the previous deployed version. If this is not possible, stop and retain the current publish policy.
3. Create a **separate manual promotion path** for a pinned version ID, after reviewing cumulative tests, exact commit/build attestation, D1 Time Travel bookmark/backup and explicit approval. `wrangler versions deploy --version-id <reviewed UUID> --percentage 100` is a possible manual primitive; first validate CLI and static assets behavior. Confirm deployed ID and public UI/API readback after promotion. A GitHub monitor must not implicitly perform the promotion.
4. Roll back by deploying a **previous known-good Worker version** explicitly, without reverting database state blindly. Restoring a previous build trigger command is **not** itself application rollback. Any future D1 schema migration requires a separate reviewed database rollback plan.
5. **Main is last.** Only consider making Main upload-only after the isolated Branch2 path and manual promotion/rollback have been demonstrated. Never retarget Branch2 to Main D1.

Cloudflare references: [Workers versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/), [Wrangler versions commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/), [Build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/).

### Historical GitHub Actions audit — still-live automatic Main hooks

The current candidate was inspected directly from GitHub. A number of old one-shot workflows still register `on: push: branches: [main]` and some have credentials plus **SQL writes**. The exact triggers are narrow (often matching only their own YAML or historical migration files), but this makes a future housekeeping merge involving those paths capable of re-running historical operations. Historical guard assertions are valuable but are not deployment authorization.

Confirmed high-risk examples:

- `auth-production-migrations-0080-0081.yml` — applies schema SQL to Main;
- `catalog-reference-production-schema-0090-0105.yml` — applies legacy schema;
- `client-zammler-production-migration-0075.yml`, `kaspi-production-migration-0082.yml`, `kaspi-production-post-deploy-reconcile.yml` — former release/mutation jobs;
- `main-admin-editor-schema-0110-0112.yml`, `main-retired-sku-schema-0113-0114.yml`, `main-stage04-dormant-schema-20261018.yml` — historic schema jobs;
- `stage03-production-migration-0072.yml`, `stage03-production-migrations-0073-0074.yml` — historic Stage03 migrations;
- `one-off-prod-1734-targeted-cleanup.yml` — explicit production order #1734 correction, only under `push main`;
- `oneoff-main-asiya-23-kaspi-paid-20261019.yml`, `oneoff-main-kaspi-sent-history-20261018.yml` and the October one-off catalog-color workflows — historical operational corrections triggered on matching Main pushes.

**Review and archive legacy automatic write triggers in a separate, narrowly scoped CI-only PR** before any merge that touches those workflows or their specified files. Preserve tests and the original reviewed SQL in Git history; do not re-run an old production migration for CI housekeeping. All remote SQL actions remain forbidden until approved individually. This is a prerequisite together with #656, not a claim that all old workflows have already been disabled.

### Actual D1 schema compatibility (separate completed read-only audit)

[GET/SELECT-only #41085359069](https://github.com/dymovicd123/Orders-app/actions/runs/41085359069) found Main and Branch2 mirror each have 138 tables, 388 schema objects and the critical-operation/manager audit schema, with zero schema differences. **Do not run any order-manager ALTER or CREATE** against these two working databases. The fresh-install 114-migration gap remains open as #648; release decision must not conflate it with current D1 schema.
