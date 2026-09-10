# Safe correction of posted order payments — 2026-09-10

Persisted ordinary order payments can be corrected in place from the order editor: payment date, amount, method, semantic kind (`primary` / `debt_close`) and comment. The stable `payments.id` is preserved.

The browser sends only changed persisted payments together with the snapshot it originally opened. The server compares that expected snapshot with the current payment before freezing the critical-operation plan; a stale editor receives a conflict instead of overwriting another change. Cached clients using the former method-only payload remain supported.

Each correction appends an auditable finance reversal of the old monetary fact and a corrected positive event using the corrected business date, amount, method and operation type, then updates the same payment row. Request-scoped event keys and cash source keys make retry replay idempotent. Cash uses only the tracked old/new cash delta, including successive corrections. Order `received_amount` and `debt_amount` include the corrected amount before the order row is written.

Exchange-linked extra payments retain exchange ownership: the ordinary order editor may correct their payment method only. Date, amount, kind and comment must be changed through the exchange operation. New unsaved primary payments still inherit the order date at creation time; that creation rule does not prevent correcting a posted primary payment date later.

No schema migration is required. Arrival and Branch2 are outside this change.
