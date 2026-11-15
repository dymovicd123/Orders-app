# Return V2 — staged Branch2 acceptance and Main release gate

**Status:** NOT DEPLOYED / not enabled. Current source is only in GitHub
`branch2`. Main stays untouched until this checklist passes end-to-end.
Tracking: [#864](https://github.com/dymovicd123/Orders-app/issues/864).

## 1. Source and configuration controls

- Use the `branch2` branch, not `main`.
- Target Worker: `orders-app-branch2`.
- Target database: `orders_db_branch2_mirror_20261027`, ID
  `0904a573-21ff-44d8-93b0-c9200f771702`.
- Do **not** set `RETURN_V2_ENABLED=true` before the migration and acceptance gates.
- Run `npm ci`, `npm run verify`, `npm run build` and
  `npm run verify:return-v2-branch2` locally (the last command makes **no
  remote DB changes**).
- Read-only remote capability check (requires an authenticated Wrangler session):
  `node scripts/return-v2-branch2-readiness.mjs --remote`. This checks
  precisely the Branch2 DB configured in `wrangler.jsonc`, uses only a
  `SELECT` with `sqlite_master` and `pragma_table_info`, and does not
  deploy or alter data. Exit code `2` means **schema incomplete**, not a
  successful pre-migration release gate.

## 2. Backup BEFORE any remote schema mutation

First verify the database ID and the currently deployed Worker target using
Cloudflare. **Do not operate on Main**.

Create a securely retained SQL export of the **Branch2** D1 *before* the first
new migration, e.g. from the checked-out Branch2 repository:

```powershell
npx wrangler d1 export orders_db_branch2_mirror_20261027 --config wrangler.jsonc --remote --output branch2-before-return-v2.sql
```

Check that the export command completed successfully, the file is nonempty,
and that its schema includes the existing operational tables. Store the backup
securely outside version control; it contains customer data and must **never**
be committed. Cloudflare D1 Time Travel information should also be recorded
before migration, but **not** used as a replacement for an export. Export can
briefly affect remote D1 availability; schedule this only for the test Worker.

## 3. Schema-first Branch2 migration

The following are **additive** migrations. Apply strictly in numeric order,
**only after** inspecting the remote schema to see which, if any, have already
been applied. In particular, `ALTER TABLE ... ADD COLUMN` is not safely
repeatable. Do not blanket-replay all files and do not use an unverified
`wrangler d1 migrations apply` against a DB without a confirmed migration
journal.

| Migration | Purpose |
|---|---|
| 0124 | Prepared operation and item journal |
| 0125 | `return_items.contract_quantity_applied` |
| 0126 | Version markers and V2 posting evidence |
| 0127 | V2 cancellation evidence |
| 0128 | Unified posted Return and exact per-item history |
| 0129 | Immediate/pending receipt intent |
| 0130 | Unified cancellation and cash recovery |
| 0131 | Versioned metadata corrections journal |
| 0132 | Exactly-once resumed-shipment journal |

Example of one explicitly reviewed migration, **not** an automated batch:

```powershell
npx wrangler d1 execute orders_db_branch2_mirror_20261027 --config wrangler.jsonc --remote --file migrations/0124_return_v2_prepared_journal.sql
```

Check the exit status and schema before proceeding to 0125, and so on through
0132. Do not change the feature flag during this phase. A failure or ambiguous
result means **STOP**, inspect the schema and the backup, do not guess or rerun
an `ALTER TABLE`.

After the last migration, run:

```powershell
node scripts/return-v2-branch2-readiness.mjs --remote
```

Readiness must show all **9 tables and 10 critical columns**. This only proves
schema capability; it does not prove that the business workflow is safe.
Return V2 is still **OFF**.

## 4. Staging Worker + real browser acceptance

First publish the current `branch2` Worker against the fully migrated
**Branch2 only**, leaving `RETURN_V2_ENABLED` false. Verify current V1
Returns/Exchanges/dispatch still work and their money/physical stock semantics
have not changed. Only after this smoke test, enable `RETURN_V2_ENABLED=true`
**for Branch2 only**, through an explicitly reviewed Cloudflare Worker
configuration/deployment. Do not enable it in shared or Main config.

In a controlled test fixture (not an employee's live financial order), verify
with both manager and admin accounts:

1. All eligible remaining shipped **and unshipped** items are selected by
   default; unproven items are labelled for review, not guessed.
2. Removing only an **unshipped** item releases its reservation, with **no**
   physical stock +1/-1 and correct reduced sale price.
3. Sent/physically returned item can be received **immediately** into Warehouse
   or Boutique, **or** to `no_stock`, or remain `pending`. No duplicate
   intake; account for stocktake checkpoints explicitly.
4. Proposed refund initially equals selected original sales value **capped by
   actual net money held**, can be edited to 0, payment method is empty until
   chosen; net debt and overpayment verified before and after saving.
5. Two returns of different remaining items preserve the contract chain;
   repeat partial cancellation of the **same unshipped reservation** reduces
   remaining reservation precisely, without physical +1.
6. Cancel a not-yet-received Return only after confirming real cash recovery,
   unreceived shipped goods and reservation capacity. Physical stock must
   remain unchanged; equal retries are read-only.
7. After physical intake, old V1 cancel/exchange/edit/shipping must NOT bypass
   versioned history. Where a versioned corrective workflow is not implemented,
   show a meaningful denial, **never silently mutate stock**.
8. Retry after lost HTTP response with the **same request ID**: one return, one
   payout, one warehouse intake. Mismatched request payload denied.
9. Concurrent updates, stocktake boundaries, mixed source orders, no-reserve
   and shortage observations: no phantom stock, double refund, or broken debt.
10. Check other orders' normal Return V1, exchanges and dispatch unchanged.
    Verify no unintended activity in Main.

Keep an acceptance record with screenshots, actual identifiers in **test DB
only**, financial/stock before-after snapshots, tester, and explicit open
exceptions. A passing existing Chrome regression on source code is **not**
a replacement for this enabled-feature browser acceptance.

## 5. Main release is separately gated

Do **not** automatically replicate Branch2 schema or feature flag to Main.
Before Main:
- Resolve or explicitly document the still-unsupported **exchange after V2**
  and **cancellation after physical intake** flows; these cannot fall back to
  legacy writers. Any high-frequency blocker means **no Main release**.
- Confirm completed Branch2 browser UAT and owner approval; independently
  snapshot and export Main D1.
- Review migration applicability and deployment config for the different Main
  database/Worker, use a fresh Main-specific change set, deploy schema-first,
  keep flag off through smoke test, then enable gradually and audit.

**Rollback:** On a Branch2 failure, disable the Return V2 flag first; avoid
rolling back the schema blindly while V2 journal entries exist. Retain the
actual return, payment and physical intake records. Restoring a D1 backup or
Time Travel rewinds unrelated test orders too; perform only with an audited
scope and explicit operator approval. Never copy a Branch2 database over Main.
