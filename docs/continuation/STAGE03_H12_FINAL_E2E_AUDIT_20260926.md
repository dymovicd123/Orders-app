# Stage03 H12 — final end-to-end pricing audit

Date: 2026-09-26

Environment: **Branch2 only**.

## Purpose

H12 is the final Stage03 integration audit. It does not invent a new pricing model. It verifies that the confirmed Stage03 rules still agree across the complete operational chain:

Create → Edit → payments/debt → Warehouse → Workshop → Return → Exchange → reports/history.

## Canonical pricing truth

For `itemized_v1` orders:

- `catalog_price_snapshot` is the historical Catalog recommendation captured with the line;
- `unit_price` is the factual final sold unit price;
- a discount is represented by lowering the final sold price amount, not by a separate percentage source of truth;
- `line_total = quantity × unit_price`;
- `orders.total_amount` is derived from active itemized line totals;
- payments are independent money facts;
- debt is based on persisted commercial total minus actual received payments;
- current Catalog prices never reinterpret historical sales.

For `legacy_manual_total` orders:

- the historical order-level total remains authoritative;
- the system must not invent exact legacy product prices or distribute a legacy order total across lines.

## Operational audit

### Create

- new Branch2 orders explicitly use `itemized_v1`;
- Catalog recommendation and final sold price remain separate;
- missing recommendation may be replaced by an explicit manager-entered sold price;
- zero sold price remains valid;
- overpayment remains blocked.

### Edit

- direct sold-price correction is supported;
- price-only changes must not become inventory rewrites;
- content changes use the guarded itemized rewrite contract;
- stale total / old line / Catalog snapshot protections remain authoritative;
- payment corrections remain explicit money corrections rather than price mutation.

### Payments and debt

- payment rows remain actual received-money facts;
- debt closing reads the persisted financial ledger;
- Catalog recommendation is absent from debt/payment logic;
- overpayment remains blocked.

### Warehouse and Workshop

- operational stock/reservation/status flows may consume order identity and quantity;
- they must not rewrite `orders.total_amount`, `order_items.unit_price`, or `order_items.line_total`;
- Workshop remains an operational fulfillment surface, not a pricing authority.

### Return

- physical returned items and refund money are independent;
- new refund drafts start at zero;
- manager enters the factual refunded amount;
- sold price or Catalog price is not an automatic refund rule;
- refund cannot exceed available received money.

### Exchange

- itemized replacement lines carry their own factual sold price and separate Catalog snapshot;
- active itemized lines determine the commercial order total;
- actual extra payment/refund is a separate money fact;
- stale old-line commercial state and unexplained overpayment remain blocked.

### Reports and history

- headline Finance values stay on persisted order/payment/return/debt facts;
- product popularity is ranked by sold quantity;
- average sold price is quantity-weighted from exact `itemized_v1` line totals only;
- legacy units may contribute to popularity but cannot fabricate a historical average price;
- retained history preserves pricing generation;
- current Catalog values never reprice history.

## Resolver R11 preservation boundary

Resolver R11 is an independent production/Branch2 fix and is **not part of Stage03 pricing policy**. H12 must preserve it while Stage03 is closed and later promoted:

- manager-entered concrete gender remains authoritative;
- otherwise the concrete gender of the selected existing Catalog SKU is preserved;
- fixed product gender scope is only a fallback;
- selecting an `unisex` product must not erase a gender already known from the manager or Catalog SKU;
- the old `gender: automaticGender ? (selected.gender || automaticGender) : ''` behavior must never return.

The H12 candidate must include and pass `scripts/test-catalog-resolver-r11-preserve-known-gender.mjs`. Future Stage03 → main promotion must reconcile `useWorkspaceViewModel.tsx` deliberately instead of replacing Production with a stale pre-R11 copy.

## Scope boundary

H12 adds an aggregate regression/acceptance layer and documentation. It does not add a migration, backfill, D1 business-row write, new discount source of truth, automatic refund rule, or new Workshop finance behavior.

**No Production/main action is part of H12.**

## Completion rule

Stage03 may be called technically complete on Branch2 only after:

1. H12 focused acceptance passes;
2. the full cumulative release gate and application build pass on the H12 work branch;
3. H12 is merged only into `branch2`;
4. the exact merged Branch2 SHA passes the Branch2 safety workflow;
5. the exact merged Branch2 SHA receives `cloudflare-deploy/branch2 = success`.

Stage04 Workshop finance remains a separate roadmap stage.
