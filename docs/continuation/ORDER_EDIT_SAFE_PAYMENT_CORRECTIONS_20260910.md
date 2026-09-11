# Safe correction of posted order payments — 2026-09-10

## Final status

Completed and live in Production.

- PR #31 `Fix safe correction of posted order payments` was squash-merged to `main`.
- Production source commit: `6653e0ab4f438dca6832eb233624faed5a01602a`.
- Full GitHub Quality check run `34486738784` passed, including the cumulative regression gate and application build.
- Cloudflare deploy monitor run `34486914530` completed successfully for the exact main commit.
- No schema migration was required. Arrival and Branch2 were not changed.

## Behavior

Persisted ordinary order payments can be corrected in place from the order editor: payment date, amount, method, semantic kind (`primary` / `debt_close`) and comment. The stable `payments.id` is preserved.

The browser sends only changed persisted payments together with the snapshot it originally opened. The server compares that expected snapshot with the current payment before freezing the critical-operation plan; a stale editor receives a conflict instead of overwriting another change. Cached clients using the former method-only payload remain supported.

Each correction appends an auditable finance reversal of the old monetary fact and a corrected positive event using the corrected business date, amount, method and operation type, then updates the same payment row. Request-scoped event keys and cash source keys make retry replay idempotent. Cash uses only the tracked old/new cash delta, including successive corrections. Order `received_amount` and `debt_amount` include the corrected amount before the order row is written.

Exchange-linked extra payments retain exchange ownership: the ordinary order editor may correct their payment method only. Date, amount, kind and comment must be changed through the exchange operation. New unsaved primary payments still inherit the order date at creation time; that creation rule does not prevent correcting a posted primary payment date later.

## Release-gate work completed with the feature

The first implementation was functionally correct but exposed stale historical gate assumptions. Before merge, the release chain was updated deliberately rather than bypassed:

- Step 189C money-history static gate accepts the audited in-place correction mutation;
- Finance F5 entry-semantics gate now checks safe posted-payment correction rather than the retired method-only restriction;
- Worker 1906A structural preservation has an explicit exact safe-payment-correction delta manifest;
- frontend 1906B preservation has an explicit exact App delta manifest;
- the dedicated payment-correction regression remains part of `npm run release:check`.

The broader lesson and remaining operator-autonomy gaps are recorded in `docs/continuation/OPERATIONAL_AUTONOMY_AUDIT_20260910.md`.
