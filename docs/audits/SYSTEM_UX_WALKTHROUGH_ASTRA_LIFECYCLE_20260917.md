| Record | External/operation ID | What was changed | Final observed state |
|---|---|---|---|
| Existing disposable order | `TEST-RESOLVER-BE-20260916-35126549387` | One prerequisite payment, R1, physical receipt R2, cancellation C1, then R3. No changes to product identity or original shipment. | After final F5: «Оплачено / Отправлен / Возвращён», amount 1, received 1, debt 0. R3 is the only active refund. |
| Prerequisite payment | Same order; separate numeric operation ID not visible in inspected UI | Closed test debt: 1, ТЕРМИНАЛ, dated 2026-09-17. Comment: `TEST UX LIFECYCLE 20260917 — prerequisite 1-unit test payment for R1` | Persisted; total incoming money 1. Not cancelled. |
| R1 → R2 → C1 | Same order; Return dated 2026-09-17; numeric Return ID not visible | Refund 1 via ТЕРМИНАЛ, one item «Ещё не пришёл»; later «Товар пришёл → Склад»; cancelled once on 2026-09-18. Comment: `TEST UX LIFECYCLE 20260917 R1 — refund 1; physical item pending` | «Отменён»; «Получен; проведение в Склад отменено». Refund excluded from active totals. Observed stock sequence 0 → 1 → 0. History retained. |
| E1 unsaved form | Same order; no Exchange ID created | Prepared replacement using existing БАЯН СҰЛУ ШАПАН, ЖЕН, СВЕТЛО-БЕЖЕВЫЙ, КОСТЮМНЫЙ МАТЕРИАЛ, СТАНДАРТ length, size 48; old item pending, zero money delta. | Not submitted: UI reports physical shortage of 1. No stock confirmation or adjustment performed. Draft abandoned. |
| R3 | Same order; Return dated 2026-09-18; numeric Return ID not visible | Refund 1 via ТЕРМИНАЛ, one item «Пришёл, в остаток не добавлять». Comment: `TEST UX LIFECYCLE 20260917 R3 — received; do not add to stock` | After F5: «Проведён», «Получен, в остаток не добавляли». Pending 0; physical/free/reserved stock 0/0/0. |

# Phase 1 — Return / Exchange lifecycle truth

GUI observations: 2026-09-17, resumed and completed 2026-09-18 after a quota interruption. Only live Branch2: `https://orders-app-branch2.orders-clothes.workers.dev`. Repository documentation branch: `audit/system-ux-walkthrough-20260917`.

Expected deployment baseline from handoff: `fb43e8d709b57b67cc080bb9bd64246bb036aede`. The inspected GUI did not expose a deployed SHA; baseline is **not independently verified**. Findings describe the live UI observed, not a source-code diagnosis. The pause crossed a calendar day; R3 intentionally retains the normal current UI date, 2026-09-18.

Budget: approximately 15 minutes of active GUI work before interruption plus approximately 6 minutes on resumption; the offline interruption is excluded. No broad navigation, performance tests, source inspection, raw API calls or SQL. Required context documents were read. Computer-use guidance was used for browser interaction and fresh-state verification.

Mutation limits used: **0/2 new orders; 2/2 successful Returns; 0/1 successful Exchanges; 1/1 cancellations**, plus one prerequisite test payment of 1. All business writes concerned the single existing TEST order above. No cleanup, deletion, production access, direct stock adjustment, extra financial correction, commit, push or deployment.

## Result in one paragraph

The tested Return lifecycle preserves its arithmetic across reloads: pending receipt did not show a restored unit; receipt added one; cancellation removed that addition and the active refund; received-without-stock did not add a unit. The biggest observed weakness is **communication between surfaces**, not a demonstrated loss of persisted state: the order row compresses distinct physical states into «Возвращён», retains «Оплачено / Получено 1» after a full refund, and uses different product/material wording from the stock view. Exchange lifecycle correctness remains **unverified**, not passed or failed: the inspected replacement had no physical stock, and inventing availability was outside the safety rules.

## Evidence register and transition results

References below identify browser observations in this audit conversation, not files containing screenshots. AX refers to the browser's rendered accessibility text, not source or database inspection. No screenshot files were saved. A pre-interruption screenshot supports the R1 history summary, but not its off-screen item details; those were read from AX. The E1 screenshot shows the zero-delta form and submit button, not the shortage message above it.

| Evidence | Transition and observed result |
|---|---|
| EV-01 | Prerequisite payment: 1 via ТЕРМИНАЛ. After F5 the existing issued order became paid, received 1, debt 0, active. |
| EV-02 | R1: before and after F5, Return history showed refund 1, «Проведён», pending 1 item; expanded detail showed «Ещё не пришёл», destination selector and «Товар пришёл». Order row showed «Возвращён / Оплачено / Отправлен», received 1, debt 0. Stock search showed one matching position, physical/free/reserved 0/0/0. No pre-R1 stock baseline was captured: this proves observed pending state had zero stock, not a measured pre/post delta for R1. |
| EV-03 | R2: receipt clicked once for Склад. Browser automation reported interruption by a native confirmation; the subsequent dialog handle was absent. No second receipt click was made. Immediate success text was not captured reliably. After F5/reopening: «Получен → Склад», pending 0, receipt action gone. Matching stock position: physical/free/reserved 1/1/0. Finance: incoming 1, refunded 1, net 0. |
| EV-04 | C1: resumed history still showed «Получен → Склад», refund 1. One cancellation click; confirmation said money/status would be cancelled and newer factual stock data, if any, preserved. Immediate result: «Отменён», «Получен; проведение в Склад отменено»; a fresh Return form opened automatically. After F5 the history retained those statuses; order was active, paid, issued, received 1, debt 0. Stock 0/0/0. Finance incoming 1, refunded 0, net 1; «Данные согласованы». Stock value 1 before C1 was recorded before the interruption, not freshly remeasured immediately before the click. No intervening unrelated stock changes were established. |
| EV-05 | E1 form only: old item «Ещё не пришла», replacement from Склад, quantity 1, «Без доплаты/возврата», amount 0. Known variant entered explicitly. UI: «По учёту физически не хватает 1 шт.» and «Товар есть — уточнить фактический остаток». «Оформить обмен» remained enabled. Neither submit nor stock-confirmation was clicked; server-side enforcement is untested. |
| EV-06 | R3: after save, returned to order table; incoming 1, refunded 1, net 0. History before and after F5: one active Return and one cancelled Return; «Получен, в остаток не добавляли», pending 0. Order row remained paid/issued/returned, received 1, debt 0. Stock remained 0/0/0. Finance after F5/reopening: total incoming 1, ordinary refunds 1, net 0; 17.09 incoming 1/refunded 0, 18.09 incoming 0/refunded 1. Cancelled R1 was not counted twice. |
| EV-07 | X1: in ordinary mode, receipt and cancellation were separate named controls. Existing «Войти в админ режим» opened login/password form. No credentials entered or guessed; form dismissed. Admin financial-correction controls not inspected. |

Stock position throughout the checks: **БАЯН СҰЛУ ШАПАН · СВЕТЛО-БЕЖЕВЫЙ · 48 · Взрослый · ЖЕН · КОСТЮМНЫЙ МАТЕРИАЛ**, one position in the search result. Return/order text instead contained **БАЯН СҰЛУ ШАПАН TESTМАТЕРИАЛ 20260916-35126549387**, material **СТАНДАРТ**. Quantity tracking suggests the observed stock position is affected by the Return; the GUI observations alone do not establish the underlying identity mapping.

## Findings

### L-01 — A financially completed Return looks physically finished in the order row

- **Scenario / severity:** R1, with R2/R3 comparison — **MEDIUM**.
- **Exact observation:** during R1, the order row said «Возвращён» and no longer offered its normal Return/Exchange actions. Expanded Return history correctly said «Ещё не пришёл» and offered «Товар пришёл». The same order label also covered received-to-warehouse and received-without-stock states. History's collapsed operation summary said «Проведён»; the per-item physical state required expansion. The history page did expose a global pending counter, so the fact was not absent everywhere.
- **Shortest reproduction:** refund one issued TEST item with physical state pending → inspect order row → open Return history and expand the operation.
- **Before F5:** returned order label, while history still had one pending item.
- **After F5:** same distinction and same pending action; no persistence regression observed.
- **Other surfaces:** stock was 0 while pending and became 1 only after R2. History and stock agreed. The order summary omitted the outstanding physical task rather than exposing a different numerical quantity.
- **Human risk:** a tired manager working mainly in the order table can reasonably treat the job as finished and never reopen the dedicated Return history. An aggregate pending count cannot identify the outstanding task from that order row.
- **Evidence:** EV-02, EV-03, EV-06; R1 history-summary screenshot in conversation and AX details.
- **Simplest direction:** distinguish «Деньги возвращены; товар ещё едет» from physically completed outcomes at the order/operation summary. Put the existing next receipt action beside the outstanding fact, without adding a new approval process.

### L-02 — The returned thing is described differently in history and stock

- **Scenario / severity:** R1/R2/C1/R3 — **MEDIUM**.
- **Exact observation:** order and Return history displayed the long TEST product name and material «СТАНДАРТ»; the single stock result whose quantity changed displayed the shorter product name and «КОСТЮМНЫЙ МАТЕРИАЛ». There was no visible explanation of their correspondence in the inspected Return details.
- **Shortest reproduction:** open the tested Return's item details → search БАЯН СҰЛУ ШАПАН in stock → compare name, material and size.
- **Before F5:** Return details used the original long name/material.
- **After F5:** that description persisted; stock checks after receipt/cancellation used the shorter name/different material. Quantity moved 0 → 1 → 0.
- **Other surfaces:** quantity changes were coherent, but item descriptions were not interchangeable for a human reader. This is not proof that stock was posted to a wrong item; the TEST fixture deliberately came from a resolver scenario.
- **Human risk:** the employee has to infer that two differently described things are the same stock position. They may conclude receipt failed, search for the wrong material, or consider an unnecessary correction.
- **Evidence:** EV-02 through EV-06 and the exact paired descriptions above.
- **Simplest direction:** where an older item description differs from the current stock item, show their relationship explicitly in the operation. Preserve the historical wording without making the user deduce where the item was counted.

### L-03 — After a full refund, the order row still reads like money is retained

- **Scenario / severity:** R1/R3 — **MEDIUM**.
- **Exact observation:** after refunding the only payment of 1, the order row still showed «Оплачено», «Получено 1», debt 0, and «Возвращён». It did not show a separate refunded amount in that row. Period summary and Finance correctly showed incoming 1, refunded 1, net 0.
- **Shortest reproduction:** fully refund the paid TEST order → read its payment columns/status → compare Return history and Finance.
- **Before F5:** gross receipt 1 and paid status remained; overall cash movement was 0.
- **After F5:** same presentation for both tested successful Returns. Cancellation restored net 1 without changing received 1, which further shows that this column is not net cash.
- **Other surfaces:** no arithmetic contradiction established. Historical gross receipt and net retained money are different measures; Finance named and separated them, while the order row did not make this distinction locally obvious.
- **Human risk:** when answering a customer from one row, a manager can read «Получено 1 / Оплачено» as still holding the customer's money, or assume «Возвращён» describes only the thing.
- **Evidence:** EV-02, EV-04, EV-06; rendered order row and finance summary.
- **Simplest direction:** retain the original payment history, but show the order's refunded amount next to it. Make clear which value is original receipts and which is money retained after refunds.

### L-04 — Cancellation ends on a new Return form rather than a clear reversal result

- **Scenario / severity:** C1 — **LOW**.
- **Exact observation:** cancelling R1 automatically opened a new Return form for the same order: available 1, new refund amount 1, item quantity 0. The cancelled operation was still present lower in history, correctly labelled. Its reason read «Отменено из интерфейса Cloudflare», which identifies a technical interface rather than a human reason.
- **Shortest reproduction:** cancel the tested received Return once → inspect the resulting screen without navigating elsewhere.
- **Before F5:** new form plus cancelled history. The history explicitly retained «Получен; проведение в Склад отменено».
- **After F5:** reopening Return history showed no open form; cancelled history and its physical wording persisted. This is a transient navigation/state difference, not loss of the cancellation.
- **Other surfaces:** order reactivated; stock returned to 0; active refund became 0 and net incoming became 1. No one-sided reversal was observed.
- **Human risk:** the most prominent form now invites another refund when the employee has just finished cancelling one. The user must look past a new operation to establish what was actually undone.
- **Evidence:** EV-04, immediate AX after cancellation versus reopened history.
- **Simplest direction:** finish cancellation with a compact result that names the money and stock effects, keeping a new Return an explicit choice. Use human-readable cancellation provenance rather than infrastructure branding.

### Lifecycle that already feels coherent

- Physical receipt is a separate fact from refund money. R1's pending state, the later receipt action, and R3's received-without-stock wording survived reloads.
- For the one tested position, receipt added exactly one unit; cancellation removed that unit; received-without-stock left sellable quantity unchanged. No duplicate count observed.
- Cancellation retained history and the fact that the thing had been received, instead of silently erasing the operation. Its money and stock effects both reversed in the inspected case.
- Finance clearly separated incoming money, refunds and net movement. Cancelled R1 was excluded; R3 appeared on its own operation date. The order-level period summary agreed with Finance.
- In ordinary mode, «Товар пришёл» and «Отменить возврат» were distinct controls. E1 allowed choosing old-item physical state independently from zero monetary delta and explicitly raised a shortage before any submission.

### Cross-surface contradictions

- **Confirmed descriptive mismatch:** the tested operation and affected stock result used different product/material descriptions (L-02). Whether this is intentional historical naming or a wrong mapping requires a separate code/data check; GUI alone cannot decide.
- **Completion-signalling mismatch:** the order's unqualified «Возвращён» coexisted with «Ещё не пришёл» in history (L-01). This is an ambiguity about what is complete, not evidence of premature stock restoration.
- **No demonstrated money/quantity arithmetic contradiction** in completed R1/R2/C1/R3. «Получено 1» versus net 0 is a gross/net communication problem (L-03), not proof of divergent balances. After C1, «Получен; проведение в Склад отменено» and stock 0 agree about reversal, although the physical disposition after reversal is not explained by a number alone.

### Untested because setup would be wasteful/risky

- **E1 — NOT TESTED end to end.** The normal form was inspected, but the known replacement was physically short by 1. No replacement issued, no Exchange saved, no pending old-item Exchange history or later Exchange receipt verified. Creating availability or claiming «Товар есть» without a factual basis would violate the handoff. The enabled submit button was not exercised; do not infer that it permits bypassing shortage.
- **X1 — PARTIAL.** Ordinary receipt versus cancellation was observed. Admin entry required login/password; credentials were not provided or guessed. Financial correction versus cancellation inside Admin remains unverified. No extra corrections performed.
- Cancellation when a newer independent warehouse count supersedes the receipt was not tested. The confirmation mentioned preservation of newer factual data, but this run did not create such a case.
- No partial/multi-item refund, Boutique destination, second cancellation, or alternate replacement search across the catalog. These are outside the selected minimal lifecycle evidence.
- R2's immediate native-confirmation/success display could not be reliably captured because of browser-tool handling. Persisted success was checked after reload without repeating the write; this tooling limitation is not classified as an application bug.
- Deployed SHA and internal operation IDs were not exposed by the inspected GUI. No source/API/database probing was used to fill those gaps.

### Handoff questions for code audit

1. Which stock item does the TEST-BE Return actually reference, and why do its historical material/name differ from the stock position whose quantity changed?
2. Does «Возвращён» in the order list intentionally represent only the commercial operation, independently of pending physical receipt?
3. Are «Получено» and «Оплачено» intentionally based on gross historical payments after a full refund, and is an order-local net/refunded value already available?
4. What exact condition decides whether cancelling a received Return reverses its stock effect or preserves newer physical facts, and what does the retained receipt fact then represent?
5. Does submitting E1 with a known shortage enforce a stock check even though «Оформить обмен» is enabled, and what state is persisted if that check fails?
6. Is opening a new Return form immediately after cancellation intentional, and is the technical cancellation reason stored as the only reason or merely displayed as provenance?

### Stop point

**Phase 1 ended on 2026-09-18. Warehouse Phase 2 was not started.** All allowed test records were left intact for inspection; no cleanup or second reversal. R1/R2/C1/R3 have reload and relevant cross-surface evidence; E1 and Admin-only X1 remain explicitly limited above. No code changes or Production access. This report is the only file created for this phase; commit/push were not requested.
