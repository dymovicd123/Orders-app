# Orders-app — current Warehouse context and W3 doctrine

Updated: 2026-09-05 (Asia/Almaty)
Context branch only: `context/project-continuation`

This file is the current canonical Warehouse continuation note. It supersedes older Warehouse planning sections in `CURRENT_PROJECT_CONTEXT.md`, `WAREHOUSE_AUDIT_2026-09-05.md`, and `WAREHOUSE_EXTERNAL_RESEARCH_2026-09-05.md` where they conflict with later W2/W2.1 decisions or the user's newer product requirements.

Do not merge this documentation-only file to Production merely to keep context current.

## Authoritative code baseline

Production/default branch is `main`.
Current main commit while this note was written:
`1cf1f302dfbb8e7852bdbb0e3a3a5a5a7bd02d26` — `W2.1: fix Warehouse Attention refresh race`.

W2 Production parent:
`eb4d5f8704dadbcff8124835d414b81995356bbe` — `Complete W2 human warehouse step`.

Treat current `main` as authoritative source. Never use the old uploaded `orders-app.zip` as current code.

`branch2` is a separate environment and is OUT OF SCOPE unless the user explicitly asks to work on it.

## Branch review rule

On 2026-09-05 all 251 repository branches were enumerated.
The repository contains many historical `safe/`, `ops/`, `diag/`, `tmp/`, Finance, Phase2, D1 profiling, Branch2, and validation branches. They are audit/history evidence, not alternate current source trees.

Relevant lines of history include:
- `safe/w1-warehouse-reliability-20260905`
- `safe/w2-human-warehouse-20260905`
- `safe/w2-attention-refresh-r1-20260905`
- `safe/stocktake-lost-response-20260825`
- `safe/exchange-stale-handover-hotfix-20260901`
- `safe/shipping-shortage-hotfix-20260831`
- `safe/arrival-save-reliability-20260829`
- `safe/manager-routine-access-r1-20260902`
- `safe/d1-read-budget-r5-11-lazy-catalog-20260905`
- Workshop backlog/repair branches from 2026-09-05

Do not merge or cherry-pick old branches merely because their names sound relevant. Re-audit any historical code against current `main` first. Several old branches are intentionally behind/diverged because their fixes were later promoted/squashed or superseded.

## Product north star

The Warehouse must be a human work application, not a technical database console.

The ordinary employee should think in physical/business facts:
- товар пришёл;
- товар здесь / товара здесь нет;
- здесь столько штук;
- товар переместили;
- заказ выдали;
- вещь вернулась из Цеха;
- нужно быстро проверить одну позицию.

The user should not have to understand lifecycle flags, reconciliation internals, event types, database identity, technical freshness states, or internal queue architecture.

Complexity may exist underneath, but ordinary screens should expose only the next useful human action and plain-language consequences.

## Core safety doctrine: do not block work without a real reason

Do NOT introduce blanket blocking merely because inventory truth is imperfect.

A user may:
- be in a hurry;
- be working from a phone;
- be at home;
- have no physical access to the warehouse/boutique;
- legitimately be unable to verify stock at that moment.

Therefore:
- physical verification is normally a recommendation, not a requirement;
- `Не сейчас`, `Не могу проверить`, or an equivalent safe path must remain valid where the operation itself can safely continue;
- never force a user to claim a physical fact they did not observe;
- never make order creation or another routine safe action depend on stock verification without a concrete safety reason;
- if something really must be blocked, explain in plain language WHY, what object is affected, and what will allow continuation;
- block the smallest unsafe object/action possible, never unrelated work.

A hard block is justified only by a real invariant or ambiguity that makes the requested mutation unsafe, not by a desire to keep the database tidy.

## Voluntary continuous self-recovery

W3's central idea is **voluntary continuous warehouse self-recovery**.

The goal is NOT to make `Нужно уточнить` the center of work.
The goal is that routine use continuously refreshes warehouse truth in small, natural contributions, so the system does not wait until the next full revision to recover.

The mechanism should borrow the useful pattern behind opportunistic cycle counting / contextual fact checking:
- ask at a good moment;
- ask for one small fact;
- make it optional;
- make the benefit obvious;
- avoid guilt, punishment, score pressure, or nagging;
- do not interrupt the main task unnecessarily.

Preferred psychology is gentle contribution, not compliance pressure.

Examples of tone:
- `Если товар сейчас рядом, можно быстро уточнить остаток.`
- `Не смотрел` / `Не сейчас` are normal outcomes, not failures.
- After a real check: `Спасибо. Остаток теперь актуальнее для команды.`

Avoid artificial gamification, leaderboards, productivity scoring, or rewards for quantity of checks. Wrong confirmations can damage real inventory truth, so the system must reward accuracy and convenience implicitly, not volume.

## Contextual / opportunistic check moments

Potential natural moments to offer an OPTIONAL tiny check:
- while viewing a stock/product position;
- immediately after a movement involving that exact SKU;
- during handover/issuing when the item is physically in front of the employee;
- when receiving a known item back from Workshop;
- during return/exchange handling;
- after a real mismatch or stale-stock signal;
- from an explicit small `Короткая проверка` entry point when an employee has a free minute.

Order creation deserves special caution: the employee may be remote. A stale-stock hint may invite verification **only if the item is actually nearby**, but must not pressure or block a remote manager.

Do not repeatedly re-prompt the same user/context after `Не сейчас` / `Не могу проверить`. Avoid prompt fatigue. Prefer timely moments over frequent moments.

## Physical truth and counting

Inventory model remains:
- `Физически`
- `Зарезервировано`
- `Доступно`

Reservations are tied to orders. Physical write-off occurs on actual handover/issue. Partial shipment is not a normal workflow; preserve the existing all-or-nothing model unless explicitly changed later.

For risky verification / repeated mismatch / revision, prefer blind-first counting: ask what is physically present before revealing the expected system quantity.

For low-risk deterministic confirmations, a one-click confirmation may remain when appropriate, but it must never coerce a user into claiming a fact they did not observe.

If the system's stock state is stale but the item is physically present, a valid `На месте` / physical confirmation should let safe work continue and update the relevant truth rather than trapping the employee in a recovery queue.

A newer trustworthy physical fact should automatically make obsolete warnings/questions disappear where logically sufficient.

## Natural recovery ladder

When system state and reality disagree:

1. If existing known facts are enough to repair safely, repair automatically.
2. If one small missing physical fact would resolve it, ask for that fact inline at the natural operation.
3. If the user cannot check now, park only that unresolved question and let unrelated safe work continue.
4. If identity/master-data is genuinely ambiguous, send that item to secondary recovery/admin review.
5. Never turn a successful business mutation into an apparent failure because a follow-up read/refresh failed.

Do not require users to navigate to a special recovery screen and then return to repeat the original action when the question can be resolved in place.

## `Нужно уточнить` is secondary

`Нужно уточнить` is a fallback inbox / safety net, not the primary daily workflow and not an abstract obligation to clear a backlog.

It should contain only unresolved questions that could not be safely repaired automatically or answered naturally in the current workflow.

Distinct problem types must remain understandable and must not be visually mixed into an opaque technical dump.

A card should explain:
- what happened;
- what item/order is involved;
- why the system cannot finish safely on its own;
- one clear primary action;
- a safe defer path if immediate verification is not required.

Show useful order context (identifier/date/source) where it helps.

When another flow later supplies enough truth, the stale `Нужно уточнить` item should disappear automatically. Do not require a manual `Закрыть проблему` ritual merely to clean the queue.

## Workshop return/intake doctrine

Known and unambiguous Workshop return:
- identify the canonical known variant;
- accept/reconcile as automatically as safely possible;
- do not require admin merely because it came from Workshop.

Unknown/ambiguous product or characteristic:
- preserve the physical fact that the item is already here if that is known;
- do not invent a variant;
- ask only for the missing identity/characteristic;
- escalate structural catalog decisions to admin when required.

Do not confuse `we do not know what exact SKU this is` with `the physical item is already here but awaits canonical mapping`.

Ordinary Warehouse shortage must not block Workshop at order creation.

## Catalog doctrine

Catalog is master data, not the warehouse problem dump.

Ordinary employees should not need to reason about raw database variant rows.

Controlled characteristics remain preferred:
- gender/type/color/size from dictionaries;
- material/length as execution dimensions where relevant;
- `СТАНДАРТ` / empty can be valid and must not automatically be treated as an error.

Normalize obvious spelling/value noise carefully (for example ЛЕН/ЛЁНЬ or color aliases) but do not auto-merge variants that may be genuinely distinct.

Creating/merging/retiring canonical identities is advanced/admin work. Everyday flows should encounter known variants naturally rather than forcing manual `+ Вариант` as the normal path.

## Arrival is frozen

The visual/interaction workspace for `Приход` is frozen.
Do not redesign, rename, restructure, move, or cosmetically refactor Arrival unless the user explicitly asks for it.

Preserve the known legacy workspace structure and add-position behavior.

Changes elsewhere in Warehouse must be checked to ensure they do not accidentally alter Arrival through shared CSS, shared navigation, shared loaders, or generic component refactors.

## Current W2 top-level Warehouse UX

Primary navigation is task-first:
- `Остатки`
- `Операции`
- `Проверка`
- `История`

Secondary:
- `Нужно уточнить`

Catalog is an admin-only secondary structural action.

Do not restore old primary labels/mental model such as `Внимание`, `Движение товара`, or `Ревизия` merely because historical branches contain them.

Opening `Остатки` should not automatically spend the quick-check read. `Короткая проверка` remains explicit.

## Human interface rules

Every ordinary screen should answer, in order:
1. Что происходит?
2. Нужно ли мне что-то делать?
3. Какое самое простое следующее действие?
4. Only then: details/history/technical evidence.

Prefer:
- plain Russian business language;
- fewer choices at once;
- progressive disclosure;
- one obvious primary action;
- readable mobile behavior;
- search before giant flat variant lists;
- natural consequences/preview rather than technical fields;
- calm confirmation and error copy.

Avoid:
- technical database terminology;
- developer comments/instructions visible to users;
- giant dropdowns/variant dumps;
- multi-step navigation rituals;
- generic `Ошибка` after a mutation that actually succeeded;
- forcing users to understand where a fact is stored internally.

The user will often critique UI. Treat that feedback as product requirements, not cosmetic preference.

The user does not require expensive manual/screenshot visual acceptance for every coding step. Do not burn chat/tool/Cloudflare budget on exhaustive visual QA unless it is needed for a specific uncertainty or the user asks for it. Still design carefully for a human and keep targeted automated/source regressions around changed behavior.

## Performance / Cloudflare / read-budget rules

Optimization remains a hard constraint, but do not micro-optimize high-risk truth logic for tiny savings.

Production forensic rules established after the 2026-09-05 D1 spike:
- source/static/local analysis first;
- reuse existing measurements instead of rerunning baselines;
- default hard budget for a new Production forensic investigation: <=25,000 rows_read total, preferably far less;
- if one unexpected probe approaches roughly 10k–15k rows_read, STOP and reassess;
- never run large matrices of search terms × query alternatives merely for optimization;
- intentionally larger Production scans require explicit user approval;
- SELECT-only is not automatically cheap.

R5.11 intentionally ended the broad performance pass. Do not reopen performance work without a concrete reason.

Keep these existing savings/invariants:
- do not preload the full Catalog for ordinary dashboard/order-list refresh;
- load Catalog only for product-aware flows that actually need it;
- do not load Warehouse Attention globally for a sidebar badge;
- while implementing W3, avoid duplicate parallel reads and repeated summary/detail reads;
- use already-returned payloads rather than immediately rereading the same data when possible.

Prefer source-only changes and no migration unless a schema change is genuinely necessary.

## Mutation / refresh reliability rule

A successful business mutation is success even if a secondary refresh fails.

Do not wrap mutation + several optional reads in one error path that tells the user the mutation failed.

Preferred pattern:
- commit the mutation;
- report/retain success;
- refresh dependent views best-effort;
- if refresh fails, say the change was saved but the screen could not refresh;
- preserve idempotency and avoid duplicate mutation on retry.

This rule is important because the project has already had lost-response-style bugs in Catalog Review, stocktake and other workflows.

## Adjacent-flow audit rule

Never fix an isolated Warehouse screen without checking the related flow around it.

For every W3 patch, identify the mutation/read/state it touches and audit its neighbors for the same bug class.

At minimum, depending on the change, consider:
- Orders create/edit and reservation behavior;
- Workshop task/return lifecycle;
- handover/issuing/shipping;
- returns/exchanges;
- movement between Warehouse/Boutique;
- stocktake/quick checks;
- Warehouse Attention summary/detail refresh;
- Catalog identity/review;
- history/audit rendering;
- manager/admin permission boundaries;
- stale data / request races / double click / retry / idempotency;
- D1 read amplification;
- mobile use and users who are not physically at the stock location;
- shared CSS/components that could accidentally touch frozen Arrival.

Historical branch names are useful bug-class reminders: lost response, stale handover, shipping shortage, order-save reliability, Workshop backlog visibility, manager access, and lazy Catalog loading must not regress while W3 is built.

## Work discipline for future patches

- Start from current `main` only.
- Keep changes narrow and reversible.
- Prefer one focused safe branch per step.
- No Branch2 changes unless explicitly requested.
- No Production D1 writes for diagnosis.
- No D1 migration unless clearly justified and separately reviewed.
- Reuse existing tests/gates; add focused regression for the exact bug/behavior and at least one adjacent invariant.
- Keep cumulative release checks intact rather than weakening preservation gates.
- If local execution is genuinely needed, provide one ready-to-run Windows CMD entry point from project root.
- After each meaningful step, update continuation context with: what changed, what was deliberately not changed, invariants, validation level, and exact continuation point.

## W3 plan — voluntary continuous self-recovery

W3 should be implemented incrementally, not as one giant redesign.

### W3.0 — source-only recovery map

No UI or business mutation yet.
Audit current `main` and enumerate every Warehouse recovery/problem producer and every natural place the same fact can be learned.

Classify each case:
- AUTO: system already has enough truth to repair/retire the issue;
- INLINE OPTIONAL: a tiny optional human fact can resolve it naturally;
- FALLBACK: genuinely unresolved and belongs in `Нужно уточнить`;
- HARD BLOCK: operation is actually unsafe and must explain why.

For every case, record adjacent flows and current read/mutation ownership to prevent duplicate-read/race regressions.
Do this from source first; no Production D1 profiling by default.

### W3.1 — reusable non-blocking suggestion pattern

Create one lightweight human interaction pattern for optional contribution, not a new task system.

Requirements:
- contextual;
- one small question;
- `Не сейчас` / `Не могу проверить` path;
- no false physical confirmation;
- no nagging/re-prompt loop;
- no score/leaderboard;
- no required navigation to `Нужно уточнить`;
- works on phone and does not dominate the main action.

Keep technical freshness/audit details behind secondary disclosure.

### W3.2 — first low-risk natural recovery touchpoints

Start where the product already has exact SKU context and low ambiguity, likely Stock/Operations/explicit quick-check contexts.

Use the existing physical truth and freshness protections. Do not invent new identity logic here.

Check movement, quick-check, Attention refresh, history and Arrival-adjacent shared UI for regressions.

### W3.3 — order/handover/return/workshop contextual recovery

Add suggestions only where they help and never assume the user is physically present.

Order create/edit:
- stale stock may be explained/recommended;
- verification must remain optional unless the business action is truly unsafe;
- ordinary Warehouse shortage must not block Workshop creation.

Handover/issue/return/Workshop:
- use exact item context when physically available;
- known Workshop return should self-reconcile when safe;
- unknown identity should preserve the physical fact and ask only the missing question.

Audit shipping, exchange, reservation and lost-response/idempotency neighbors in the same step.

### W3.4 — automatic retirement of obsolete recovery items

Where a newer trustworthy fact makes an old warning/question obsolete, retire it automatically.

Do not create a second manual `close task` workflow merely to clean the inbox.

Be conservative: auto-retire only when the new fact is logically sufficient. Structural ambiguity remains unresolved.

### W3.5 — slim `Нужно уточнить`

After natural/automatic recovery paths exist, simplify the fallback inbox around the remaining real questions.

Do not add feature density. Each remaining item should be understandable without knowing internal categories.

The success criterion is NOT `people clear the inbox faster`.
The success criterion is `ordinary work continuously improves warehouse truth, while the inbox contains fewer genuine leftovers`.

### W3.6 — final adjacent audit and release gate

Before promotion:
- run focused W3 regressions;
- run cumulative release checks and DB safety;
- verify frozen Arrival source invariant;
- verify no Branch2 change;
- inspect new read ownership for duplicate/race amplification;
- keep Production D1 profiling within the stated budget and skip it entirely if source/tests are sufficient;
- manual visual acceptance is optional unless a specific uncertainty remains or the user requests it.

## What comes after W3

Current likely sequence, subject to user feedback:
- W4: simplify `Операции` / movement product-selection and action flow;
- W5: finish `Проверка` hierarchy (quick / selective / full) without coercive counting;
- W6: humanize and clean Catalog/master-data UX;
- W7: one human-readable SKU history timeline;
- W8: end-to-end Warehouse acceptance across arrival, reserve, issue, movement, Workshop return, exchange/return, mismatch recovery and revision.

Do not start these merely to follow numbering. User feedback from real work remains the priority.

## Final decision test

Before adding any Warehouse UI/control, ask:

1. Does this help the employee do the physical/business job, or only help the database look tidy?
2. Can safe work continue without this answer?
3. Could the employee be remote or unable to inspect stock right now?
4. Is this the natural moment to ask?
5. Can the system infer/repair it safely without asking?
6. Are we showing one human action rather than exposing internal state?
7. Will this add unnecessary D1 reads or duplicate an existing request?
8. What adjacent flow can regress from the same change?
9. Could shared UI/CSS accidentally change frozen Arrival?

If a feature fails these questions, redesign it before implementation.
