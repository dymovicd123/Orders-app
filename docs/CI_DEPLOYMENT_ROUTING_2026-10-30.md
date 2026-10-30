# Safe Main/Branch2 CI/CD routing (2026-10-30)

This is a candidate on top of current Main CI PR #640. No Cloudflare or D1 action was taken.

- The native Cloudflare build monitor remains a **read-only monitor** of native builds and reports a failure for missing/skipped/failed builds. The previous automatic direct-production `npm run deploy` fallback is deliberately removed. Absence of a build is a release problem requiring an **explicitly reviewed deployment**, never a hidden retry through a second publisher.
- Only runtime-relevant Main/Branch2 pushes invoke the monitor. Changes exclusively to `docs/`, test scripts or workflow definitions no longer trigger the GitHub monitor; note that **Cloudflare's own build triggers are external and must be reviewed independently**. Dependency changes remain runtime relevant by design.
- Branch2 monitor verifies the October 27 isolated mirror ID. Production monitor enforces the production Worker and D1 identity separately.
- Old dated Staff and KPI selective release workflows no longer react to every Main PR or silently deploy from unrelated Main pushes; they remain accessible as historical source and scoped verification. A dated finance gate no longer reacts to `package.json` security-only updates. The current Main quality gate remains the primary mandatory contract.
- This change **does not archive all older production migration workflows**. Some can still mutate production on matching pushes; they must be inventoried and individually gated with evidence before merging the workflow-hygiene candidate. Also evaluate Cloudflare auto-build rules and required-status branch protections.

**Do not merge until completed workflow inventory, verification and explicit deployment review.**
