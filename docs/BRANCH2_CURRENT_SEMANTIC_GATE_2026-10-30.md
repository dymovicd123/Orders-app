# Branch2: current semantic release gate (2026-10-30)

**Scope:** separate current app verification from the historical source-pinned replay. This change is staged atop PR #637; **no merge into branch2/main, Cloudflare deploy, or D1 mutation** is implied.

- Default `npm run release:check` calls `scripts/branch2-current-semantic-release-check.mjs`. It requires the actual isolated 2026-10-27 Branch2 mirror D1 identity, verifies DB/script safety, then runs modern focused regressions against the unmodified working tree (shipping, physical stock, active reservations, returns, exchange dispatch, catalog, Stage04 ledger, SKU history, stocktake), followed by TypeScript/Vite build. Any failing test stops the gate. It does **not** treat a particular source-file SHA as the contract.
- The original SHA-sensitive file-substitution script remains untouched at `scripts/branch2-unified-kaspi-preserved-gate.mjs`. Its explicit invocation is `npm run release:check:historical-branch2`; this requires its *accepted historical source context*. It is **not a passing check on current code**, so it must not be run as a default current branch release gate.
- The Stage04-B2 snapshot test still uses in-memory SQLite and validates all original ledger invariants. Its Worker/D1 assertion now refers to the isolated Branch2 mirror, rejects the obsolete Branch2 DB ID and production DB ID.
- Existing Quality check continues its dependency audits and independent domain tests; other path-scoped workflows remain intact. Any red run must be investigated rather than papered over.
- **Important gap:** this suite is a concrete current regression baseline, not a proof that all old forensic scenarios are covered. CI success is not deploy approval. Merging either PR into `branch2` may start deployment workflows. Fix CI/CD safety and obtain approval first.

See `docs/CI_HOUSEKEEPING_2026-10-30.md` in PR #638 for the broader plan.
