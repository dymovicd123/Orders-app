# W7 — Exact SKU history + price-readiness audit

Date: 2026-09-06

## Goal

Connect the stable W6 exact-SKU card to truthful Warehouse history and verify that future pricing can be added later without redesigning SKU identity. Prices themselves are explicitly out of scope.

## Audit result

No new history table or backend endpoint is needed. The project already has exact-variant Warehouse history:

- `inventory_movements` stores exact `variant_id`, source, delta, resulting quantity, reference and time;
- `inventory_stock_checks` stores exact source + `variant_id` physical checks, including successful zero-difference confirmations;
- completed stocktakes feed that physical-check history;
- transfer documents/items preserve exact variants and transfer direction;
- the existing `История склада` UI already separates `Движения` from `Ревизии и сверки`, supports exact source+variant filtering and paginated reads.

Therefore W7 reuses the existing history path instead of creating parallel history infrastructure.

## User-facing integration

The exact SKU card now exposes two explicit read-only actions:

- `История · Склад`;
- `История · Бутик`.

Both pass the exact `variant_id` and explicit inventory source into the already existing history opener. History remains lazy: ordinary Catalog browsing performs no new history read. The read only happens after a person requests one source history.

The history screen keeps its existing two modes, so the same exact SKU can be inspected for movements and for physical checks/revisions.

## Adjacent history race hardening

The W7 integration exposed an existing concurrency weakness in the shared History controller: while one history request was in flight, switching source/SKU or switching between `Движения` and `Ревизии и сверки` could be ignored by the old global busy guard, after which the stale response could populate the new context.

W7 fixes this with one shared latest-request token for movement/check history. A newer source/SKU/mode request supersedes the older response; stale success/error/finally paths cannot overwrite the current history or clear its busy state. This also hardens the pre-existing `Остатки → История` entry point, not only the new Catalog buttons.

## Price-readiness contract (no prices yet)

W7 deliberately adds no `price` column, no pricing API, no migration and no price UI.

The system is already structurally ready for a later pricing decision because:

1. product identity is stable;
2. execution identity is `product + material + length`;
3. exact SKU identity is execution + audience/type + gender + color + size, represented by stable `variant_id`;
4. W6 keeps product / execution / exact-SKU commercial presentation anchors;
5. historical order transaction price already lives on `order_items.unit_price`, separately from catalog identity.

Future master/catalog pricing must remain separate from historical transaction prices. Changing a future catalog price must never rewrite `order_items.unit_price` for past orders.

The future business rule — product base price, execution price, exact-SKU override, inheritance, effective dates — is intentionally not invented now. When pricing is actually requested, that rule should be agreed first and only then should schema/API changes be designed.

## Safety / adjacent checks

- no Production D1 read/write for implementation;
- no migration;
- no new polling/background read;
- Warehouse history remains read-only for managers; destructive reverse remains under its existing admin boundary;
- SKU correction/create-similar/soft-retirement behavior is unchanged;
- transfer/stocktake/reservation mathematics is unchanged;
- Arrival remains frozen;
- Branch2 is untouched.

W7 adds a focused regression gate and a new 1906B preservation layer so the W6.4 catalog baseline continues to be checked exactly rather than weakening old guards.

## Next action

After W7 passes cumulative CI/build and Production deploy acceptance, begin W8 with a read-only/interface audit of the daily `Остатки` screen, then polish Warehouse presentation without reopening working stock mathematics.
