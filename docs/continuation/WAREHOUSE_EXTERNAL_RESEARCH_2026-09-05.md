# External WMS research — 2026-09-05

Context-only research note. Do not merge to Production by itself. W2/W3 must not start merely because this note exists.

## User goal

Warehouse should become human-oriented: an operator should understand almost immediately what happened, what the system knows, and what to do next. The interface should be calm, simple, clear and pleasant. The Warehouse must be able to recover from imperfect real-world usage through ordinary users, without blanket prohibition or requiring an administrator for routine physical truth.

The user also suspects the current Warehouse exposes too many functions and creates cognitive overload. Treat that as a primary design hypothesis.

## Systems researched

Official/current documentation and product material was reviewed for:
- Manhattan Active Warehouse Management / ActiveWarehouse
- Microsoft Dynamics 365 Supply Chain Management Warehouse Management mobile app
- SAP Extended Warehouse Management (EWM) RF / exception handling / cycle counting
- Oracle Warehouse Management Cloud mobile cycle count/task flows
- Odoo Inventory / Barcode inventory counting

Usability guidance was cross-checked against Nielsen Norman Group heuristics for complex applications and progressive disclosure.

Community reports were used only as anecdotal counterweights to vendor material, especially around Odoo/SAP complexity; they are not treated as authoritative product facts.

## Strong cross-system patterns

### 1. Mature WMS functionality is large, but frontline surface area is intentionally small

The key lesson is not to have fewer backend capabilities. It is to expose fewer capabilities at once.

- Manhattan emphasizes step-by-step in-workflow associate guidance and role-specific execution against one live operational model.
- Dynamics exposes worker-specific mobile menus and lets admins choose the task flows each work user sees.
- SAP RF supports personalized menus/screens and device-specific presentation.
- Odoo Barcode presents assigned counts as a direct pending task rather than requiring the worker to navigate a large inventory console.

Our Warehouse should therefore preserve powerful recovery/business logic underneath, while the ordinary operator sees only the next relevant action plus a small number of everyday entry points.

### 2. Recovery should happen in the workflow where the problem is discovered

Dynamics detours are especially relevant: a worker can park the current task, perform a secondary lookup/action, and return to the exact point without losing context.

This validates the prior audit conclusion that Warehouse Attention should not be the center of daily work. Shortage, handover ambiguity, intake identity, and spot-count mismatches should surface as contextual detours inside order save, issuing/handover, movement, intake/return, and stock inspection. Attention remains the fallback inbox for unresolved leftovers.

### 3. A problem should block the smallest possible object, not the whole operation

SAP EWM exception handling and RF skip-count behavior are strong models. If a bin/count cannot be processed, the affected work can be skipped/locked for later handling while the worker proceeds to the next task; responsible staff can be alerted.

This is the opposite of blanket admin gates. Our preferred model is local quarantine:
- preserve the uncertain item/order/physical fact;
- continue unrelated safe work;
- leave a clearly named recovery item;
- escalate only structural ambiguity.

### 4. Operators need both system-directed and self-initiated checks

Dynamics supports system-directed cycle counts, user-directed counts, grouped counts and spot cycle counting. SAP supports planned cycle counting plus ad hoc RF counting. Odoo lets managers assign counts while workers can execute them directly in the Barcode app.

For our scale, the useful model is three levels:
1. a tiny system-suggested daily/rotating check set;
2. a spot check available directly from any relevant stock/product context;
3. a deliberate full revision for exceptional/periodic use.

A giant visible backlog should not be the control loop.

### 5. Counting should establish physical truth, not merely confirm the database

Dynamics intentionally does not show expected quantity during cycle counting. Odoo 19 also hides expected quantity by default unless the manager explicitly requests it. This reduces anchoring users to the system value.

Our current quick-check button `Да, на месте X` is excellent for speed but is weak as an independent physical-control mechanism if used everywhere.

Preferred future distinction:
- low-risk quick verification may keep one-tap `Да, X`;
- risk-triggered/repeated-mismatch checks and revision should ask `Сколько реально?` before revealing the expected value;
- after entry, show the difference and consequences in plain language.

### 6. Freshness/concurrency protection belongs behind the human flow

Odoo explicitly warns/asks for confirmation if stock moved between a physical count and application of the adjustment. Our existing freshness/CAS ideas are therefore directionally correct.

Do not expose freshness machinery as technical states. The user should see language such as: `После вашей проверки здесь уже было движение товара. Я не буду затирать более свежие данные. Проверьте ещё раз.`

### 7. Exceptions should carry a reason and an obvious recovery action

SAP/Dynamics both model exceptions as explicit operational events. Dynamics can configure behavior such as automatic or manual reallocation after a short pick. SAP records who resolved an exception and when.

For us, exceptions should normally consist of:
- what happened in physical/business language;
- what the system currently believes;
- why it cannot safely continue automatically;
- one primary action;
- an optional secondary `не могу проверить сейчас / оставить на потом` action;
- audit/reason hidden behind details.

### 8. Advanced functionality should use progressive disclosure

NN/g guidance for complex applications strongly supports showing common actions first and moving rare/advanced actions to secondary surfaces. This directly supports the user's cognitive-overload concern.

Do not delete recovery capability merely to make the UI look simple. Instead:
- everyday actions stay visible;
- rare structural/catalog/destructive controls move under `Ещё`, `Расширенные действия`, or admin-only settings;
- technical details remain available on demand, not in the primary reading path.

## What not to copy

### Enterprise information architecture

SAP, Oracle and Dynamics can be extremely configurable and deep. Their setup/admin terminology, task types, exception codes, work pools and multi-layer menus would be counterproductive at our scale.

Borrow the control patterns, not the screen count or terminology.

### Blanket approvals

Oracle and some enterprise cycle-count configurations separate counting from inventory adjustment approval. That is useful in high-control environments but would recreate the admin bottleneck the user explicitly rejects if copied wholesale.

For our system, approval should be state/risk based: ordinary known-SKU physical corrections within safe invariants can be manager-driven; structural identity creation, destructive history rewriting and genuinely ambiguous master-data changes remain privileged.

### Gamification / labor scoring

Manhattan has sophisticated labor/gamification capabilities. This is not a current need and would add noise. The valuable part is task guidance and live operational visibility, not productivity scoring.

### AI as a prerequisite

Manhattan now markets warehouse associate agents that guide workers in-flow. The product idea is useful, but our Warehouse should first achieve deterministic human-readable guidance. AI must not become a substitute for a coherent state machine or clear recovery actions.

## Comparison with current Orders-app Warehouse

### Already directionally good

- Physical / reserved / free distinction is understandable and should remain.
- Manager-safe routine operations after W1 are aligned with risk-based permissions.
- Existing freshness/CAS and idempotency protections are stronger than the UI communicates.
- Quick rotating stock checks are a good base for system-directed checks.
- Attention categories are separated rather than mixed.
- Known intake can already be completed automatically/safely in some flows.

### Current cognitive-overload sources

1. `Остатки` mixes inventory browsing, summary, quick checks, filters, reservation drill-down and detail/history paths.
2. `Внимание` is still a full separate five-category recovery workspace even though most issues should ideally be resolved at the natural operation.
3. `Движение товара` exposes four operation modes plus source/destination/comment/product/variant selection in one general-purpose surface; it behaves like an operation console rather than a small set of natural tasks.
4. `Ревизия`, quick checks and corrections overlap conceptually from the operator's perspective.
5. Catalog/master-data concerns remain visible too close to daily operations.
6. Technical truth/history is available but the UI does not consistently translate it into `what happened -> what to do next`.

The conclusion is that the system likely has too much **visible surface area**, not necessarily too much underlying functionality.

## Proposed human-oriented Warehouse doctrine

Every ordinary Warehouse screen should answer, in this order:
1. **Что сейчас происходит?**
2. **Нужно ли мне что-то делать?**
3. **Что именно сделать следующим нажатием?**
4. Only then: details/history/technical evidence.

Primary principle: `the system should ask for the missing physical fact, not ask the user to understand the database`.

### Recovery ladder

When reality and the system disagree:
1. If the system can safely repair from existing known facts, do it automatically and tell the user what changed.
2. If one simple physical fact is missing, ask for exactly that fact inline.
3. If the user cannot check now, park only that question and continue safe work.
4. If identity is genuinely ambiguous, escalate that item to admin/master-data review.
5. Never turn a completed mutation into an apparent failure because a secondary refresh/read failed.

### Permission ladder

Manager/operator:
- count/confirm physical stock;
- spot-check any known item;
- known-SKU movement and routine correction with reason;
- known return/intake completion;
- resolve ordinary shortage/handover facts;
- continue/complete revision;
- inspect history and reservations.

Admin/advanced:
- create new catalog identity/reference values;
- merge/retire identities;
- destructive history reversal;
- force changes that bypass freshness/physical-truth invariants.

## Likely W2 redesign direction (research conclusion only, not implementation yet)

Do not begin until user explicitly approves after reading research.

1. Redefine the Warehouse landing screen around `what needs action now`, current stock, and a tiny check routine rather than a dashboard of functions.
2. Demote Attention from a primary daily destination toward `Неразобранные вопросы`/fallback inbox that appears only when necessary.
3. Build a reusable inline recovery/detour pattern so shortage, handover, intake and count discrepancies can be resolved without abandoning the current task.
4. Split physical verification into:
   - quick confirm for low-risk checks;
   - blind count for high-risk/repeated-mismatch checks;
   - explicit full revision.
5. Expose spot count from stock/product details everywhere.
6. Keep freshness and audit evidence hidden behind human language and `Подробнее`.
7. Re-evaluate top-level Warehouse navigation after observing which tasks remain primary; fewer top-level destinations are preferable.

## Likely W3 redesign direction (research conclusion only, not implementation yet)

1. Move structural Catalog work away from ordinary Warehouse mental flow.
2. Present products/variants as business identities, suppressing non-distinguishing technical dimensions by default.
3. Keep master-data creation/merge/retirement advanced and admin-only.
4. Continue to use natural business flows as the normal way the system encounters known products/variants.
5. Possible-duplicate diagnostics should be read-only until physical, reservation, order and history evidence is reconciled.

## Sources reviewed

- Manhattan Active Warehouse Management / ActiveWarehouse product pages: https://www.manh.com/solutions/supply-chain-management-software/warehouse-management and https://www.manh.com/solutions/supply-chain-management-software/activewarehouse
- Microsoft Warehouse mobile detours: https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/warehouse-app-detours
- Microsoft cycle counting: https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/cycle-counting
- Microsoft work exceptions: https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/work-exceptions-log
- Microsoft short-pick reallocation: https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/tasks/set-up-short-picking-item-reallocation
- SAP EWM exception handling: SAP Help `Exceptions`
- SAP EWM RF framework / physical inventory / cycle counting / skip counting: SAP Help
- Oracle WMS Cloud cycle count/task documentation: Oracle Cloud Warehouse Management docs
- Odoo 19 Barcode inventory adjustment/counting docs: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/adjustments.html
- Nielsen Norman Group usability heuristics and progressive disclosure: https://www.nngroup.com/articles/ten-usability-heuristics/ and https://www.nngroup.com/articles/progressive-disclosure/
