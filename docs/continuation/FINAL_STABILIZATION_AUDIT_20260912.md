# Final stabilization audit — 2026-09-12

This checkpoint closes the stabilization/audit series that followed the return/exchange physical-receipt work and the Workshop/Dashboard/Finance fixes. Client-requested product changes are intentionally left for the next step.

## Production baseline

Baseline before this final pass: `main` at `5b7f2e43c8a37a2ddbd70adaf7996b3beac19193`.

Already completed and live before this final pass:

- partial Workshop returns no longer hide remaining active Workshop tasks;
- return/exchange physical receipt has an explicit recoverable incomplete-lifecycle state and safe retry path;
- return activity text follows per-line physical destination rather than stale global restock state;
- Dashboard Workshop attention is grouped/limited at order level and preserves legitimate zero totals;
- Finance manager-day aggregation preserves distinct historical/null identities and accumulates split rows;
- date-only business semantics use explicit `Asia/Almaty` rather than accidental UTC/browser boundaries across Dashboard, Workshop periods, shipping date, archive defaults, activity/report defaults and team month defaults;
- Arrival / `Приход` and Branch2 were not changed by this series.

## Fresh Production D1 cost audit

The audit used read-only Production queries. No business row, stock row, reservation, migration journal, or schema object was mutated.

Current Production facts measured during the audit:

- `order_items`: 3536 rows;
- item rows with missing `created_at`: 0;
- unresolved catalogue identity rows: 923;
- rows that are currently actionable under the complete Warehouse Attention unresolved-catalogue predicate: 3;
- relevant unresolved active/nonarchived rows with missing item `created_at`: 0.

The exact Warehouse Attention unresolved-catalogue query plan is already protected by the intended indexes:

- the unresolved item scan uses `idx_order_items_catalog_attention_order` from migration 0063;
- returned-quantity lookup uses `idx_return_items_order_item_return`;
- pending lifecycle exclusion uses the covering `idx_inventory_lifecycle_order_item_status`;
- Workshop existence lookup uses `idx_workshop_tasks_order_item_id`;
- order lookup is by primary key.

The measured direct count cost was 1659 rows read and about 2.3 ms for three actionable rows. The remaining cost is primarily the scan of the deliberately partial unresolved-item index plus the required grouping/business predicates, not a missing obvious correlation index.

### Decision: no migration 0070

No additional Production index or query rewrite is being introduced in this stabilization pass. A date-first/expression index could reduce this individual scan, but current evidence does not justify adding permanent write/storage overhead and changing a business-truth query solely for a roughly 2 ms read whose surrounding frontend already has a short summary TTL, in-flight sharing, and mutation invalidation.

The older `earlier_reservable_units` statement seen in rolling D1 Insights could not be found in current runtime source. It is therefore not treated as a current runtime hotspot and is not being “optimized” from stale/diagnostic evidence.

This is a deliberate closure, not an assertion that all future D1 optimization is finished. If comparable clean traffic later puts Warehouse Attention or compact handover at the top again, optimize from fresh rows-read × frequency evidence, not from this diagnostic interval.

## Dependency/security audit

A fresh npm audit found seven advisories in the previous lockfile:

- production tree: one moderate DOMPurify advisory through the PDF stack;
- development/tooling tree: six high advisories, mainly through the Cloudflare Vite/Wrangler/Miniflare dependency chain plus transitive packages.

`npm audit fix --package-lock-only` refreshed only versions already allowed by the declared semver ranges. No application dependency range in `package.json` was broadened. Notable lockfile refreshes include Cloudflare Vite plugin `1.49.1 -> 1.54.8`, Wrangler `4.117.0 -> 4.131.1`, newer Workerd/Miniflare and patched Sharp/Undici/Nanoid/DOMPurify transitive versions.

After the refresh:

- `npm audit --omit=dev --audit-level=moderate` passes;
- full `npm audit --audit-level=moderate` passes;
- full cumulative `npm run release:check` passes;
- TypeScript check passes;
- production build passes;
- lint passes.

Validated finalizer run: `34692383510`.
Validated dependency-refresh commit: `e18df0babc61110d8aed170cf83fd5023be427ac`.

The permanent PR quality gate now also uses the repository `.node-version`, rejects moderate-or-higher Production dependency advisories, and rejects high-or-critical development dependency advisories before running the cumulative regression/build gates.

## Release boundary

This pass requires no D1 migration and no Production database mutation. Release is complete only after:

1. PR Quality succeeds on the exact final branch head;
2. the PR is merged to `main`;
3. `cloudflare-deploy/main` confirms the exact merge SHA.

After that, this stabilization series is closed and the next work item should be the client's new remarks, without silently reopening Warehouse W, Branch2 promotion, Arrival redesign, or the deferred 190.0 access-policy discussion.
