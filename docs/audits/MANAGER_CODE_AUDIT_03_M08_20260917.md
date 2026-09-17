# Manager code audit 03 — Astra M-08 — 2026-09-17

## Scope

Read-only code analysis of Branch2 baseline `fb43e8d709b57b67cc080bb9bd64246bb036aede`, following Astra RUN 1 manager GUI audit.

No Product/Branch2/Production code or D1 data was changed.

---

## M-08 — reports contradict themselves about the date that defines the period

### What the GUI report observed

On the Reports screen, the common filter header says:

`Период в финансовых отчётах всегда определяется по дате заказа.`

But the Payments report shown underneath says:

`Фактически поступившие оплаты за выбранный период. Каждая сумма стоит в своей дате оплаты.`

Both statements are visible at the same time.

### What the frontend says

`ReportsSection.tsx` renders the same global sentence for every report type:

`Период в финансовых отчётах всегда определяется по дате заказа.`

The report-specific renderer does not follow that rule universally:

- Payments: explicitly says the period is actual payment dates;
- Returns: explicitly says actual return date;
- Products: says products from orders whose business order date is in the selected period;
- Managers: explicitly mixes sales by order date with payments/returns by actual operation dates.

So the contradiction is structural, not a stale word inside one report.

### What the backend actually does

`worker/domains/finance-reports.ts` intentionally uses multiple timelines depending on the metric:

- sales/order counts/products/order-based city totals use `orders.order_date`;
- payments use `payments.payment_date`;
- returns use `returns.return_date`;
- exchanges use `exchanges.exchange_date`;
- debt-closure rows use payment date;
- current debt is a current-state metric and is not a period event at all.

The returned `overview` itself already mixes these concepts:

- `totalSales` is taken from an order-date query;
- `totalReceived` is computed from payment operations in the selected payment-date range;
- `totalReturns` is computed from return operations in the selected return-date range;
- current debt is current state.

This mixed model is deliberate and in several places is correctly described by the report renderer. The global Reports header is therefore factually wrong for large parts of the module.

### There is a second, subtler usability problem

The application uses one pair of date controls (`dateFrom`, `dateTo`) for reports with different event clocks.

That is technically acceptable, but the user must understand that the same visible interval means different things depending on the selected report:

- in Products it means “orders made during these dates”;
- in Payments it means “money received during these dates”;
- in Returns it means “refund operations performed during these dates”;
- in Manager report it means a mixed business view: sales from order dates plus money/refunds from operation dates.

The current interface tries to resolve this complexity with a single global sentence. That is exactly the wrong abstraction because no single sentence can truthfully describe every report.

### Root cause

This is another **generic global explanation vs contextual truth** defect.

The backend has a legitimate domain distinction between:

1. business date of the order;
2. actual date of a money operation;
3. actual date of a return/exchange operation;
4. present-state values such as current debt.

The frontend collapsed those distinctions into one global rule in an attempt to make the screen simpler. The result is simpler code/copy but a more confusing mental model for the employee.

### Simplest direction

Do not redesign finance calculations and do not force all reports onto one artificial date basis.

Instead:

- remove the global claim that all reports use order date;
- place one short period label next to the currently selected report type;
- make that label specific to what the report actually measures;
- for mixed reports, explicitly distinguish the two dimensions in a compact way rather than pretending there is one clock.

Examples of the intended *information shape* (not final wording):

- Payments — `Период: по дате оплаты`;
- Returns — `Период: по дате возврата`;
- Products — `Период: по дате заказа`;
- Managers — `Продажи: по дате заказа · Деньги и возвраты: по дате операции`.

The goal is not more prose. It is to put the date meaning exactly where the employee chooses the report.

### Do not “fix” this by changing backend semantics

There is no evidence from Astra RUN 1 that the calculations themselves are wrong. In the tested data, finance totals visually reconciled.

Changing Payments to order date merely to make the old header true would make a cash-flow report less useful and would break the already deliberate payment reconciliation model.

Likewise, changing Returns to order date would answer a different business question.

### Preserve

- Actual-operation-date accounting for payments/refunds;
- order-date sales/product reporting;
- mixed manager reporting if the customer still wants one combined manager view;
- current-debt/current-state metrics as current state;
- existing backend reconciliation logic unless a later data audit proves a numerical defect.

---

## Manager-pass conclusions after M-01..M-08

The eight GUI findings reduce to a much smaller set of recurring design defects:

### A. The application exposes navigation and module boundaries as business logic

Examples: deferred shortage path and separate catalog-resolution entry points.

Target: one business problem should have one process/action, regardless of where it is opened.

### B. The UI does not preserve provenance of a value

Examples: resolver checkmark, `Без размера`, Arrival default quantity, inferred catalog facts.

Target: distinguish unknown, inferred/default, locally selected, explicitly absent, and persisted facts before normalizing them into backend values.

### C. Applicability and eligibility are checked too late

Examples: Workshop status on stock-only orders, Return flow with refundable amount 0, Arrival submit before the physical row is truly ready.

Target: hide irrelevant controls and show whether the current action is actually possible before the main submit button.

### D. Global explanation is being used to cover contextual rules

Examples: Payments editor help and Reports date sentence.

Target: remove generic instructional paragraphs when the same rule can be shown next to the exact affected action/state.

### E. New workflows were added alongside older ones

Examples: contextual resolver vs legacy catalog review/warehouse attention.

Target: converge entry points onto shared domain actions rather than teaching each screen its own variant of the workflow.

These are simplification targets, not a rewrite mandate.

---

## Stop point

Manager code audit is complete for Astra M-01..M-08.

Next step: targeted Admin-mode GUI walkthrough on Branch2. It should be short and scenario-based, not another full-app sweep. After that walkthrough, perform code verification of only the new Admin findings and produce one consolidated simplification/fix plan grouped by the root causes above.