# Main semantic release gate — draft (2026-10-30)

This changes test orchestration only, not production code, database or deployment configuration.

- `release:check` verifies the currently committed Main Worker and exact production D1 identity (read only), focused in-memory SQLite/behavioral regressions for catalog/Resolver, reservations, shipping, warehouse, returns, order administration and Workshop, followed by TypeScript/Vite Worker+client build. Any failure fails the gate.
- `release:check:historical-main` preserves the unchanged SHA-pinned historical replay for its originally accepted source context only. We neither update historical hashes nor claim that archived releases pass against new code.
- PR #639 stages the parallel Branch2 semantic gate. PR #638 has the overall cleanup roadmap.
- **No merge into main, no deploy, and no D1 writes.** Before merging, first review obsolete one-off deploy workflows and production Cloudflare auto-publish behavior. CI success alone does not authorize deployment.
