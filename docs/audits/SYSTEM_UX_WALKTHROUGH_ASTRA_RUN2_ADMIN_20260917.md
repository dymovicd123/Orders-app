# System UX walkthrough — RUN 2 / ADMIN MODE — 2026-09-17

## Purpose

This is a **short targeted GUI/product walkthrough of live Branch2 in the existing simple Admin mode**.

It is not a code audit, not a redesign task, not a request to fix anything, and not a second full-app sweep.

RUN 1 (Manager) is already complete. Read these files first and do not repeat its broad exploration:

- `docs/audits/SYSTEM_UX_WALKTHROUGH_ASTRA_MANAGER_20260917.md`
- `docs/audits/MANAGER_CODE_AUDIT_01_M01_M04_20260917.md`
- `docs/audits/MANAGER_CODE_AUDIT_02_M05_M07_20260917.md`
- `docs/audits/MANAGER_CODE_AUDIT_03_M08_20260917.md`

Branch2 URL:

`https://orders-app-branch2.orders-clothes.workers.dev`

Expected code baseline:

`fb43e8d709b57b67cc080bb9bd64246bb036aede`

Do not touch Production.

## Critical product constraint

The customer intentionally asked for a primitive access model:

- ordinary working mode;
- simple Admin mode.

Do **not** propose accounts, complex roles, approval systems, notification workflows, “call administrator” buttons, proposal inboxes, or other new organizational machinery.

The audit question is: **with the existing simple Admin mode, can an ordinary employee/admin finish everyday problems without learning the architecture of the system?**

## Cost / token discipline — mandatory

This pass must be substantially cheaper than RUN 1.

1. Hard target: **60–90 minutes of GUI work**, then stop.
2. Do not inspect source code. The main ChatGPT agent will do code analysis afterward.
3. Do not re-check manager paths that RUN 1 already established unless needed to compare the exact same problem before/after Admin mode.
4. Maximum **2 new disposable business records**. Prefer existing TEST fixtures.
5. Maximum **1 successful catalog/master-data mutation**, only if essential to understand the Admin flow, and use a clearly disposable `TEST UX ADMIN 20260917 ...` value.
6. Do not create payments, refunds, cash movements or real stock movements merely to populate screens.
7. Do not run large searches through history or full-catalog browsing unless the tested path explicitly requires it.
8. When the same root problem appears twice, record the second example and stop reproducing that class.
9. Capture only screenshots/evidence needed for material findings; do not screenshot every screen.
10. If Admin password is unavailable, **stop and report that blocker**. Never guess credentials.

## Test data already available

Prefer these existing Branch2 test records from RUN 1 / resolver setup:

- Resolver D — order ID 8, `TEST-RESOLVER-D-20260916-35126549387`, known product with unknown gender.
- Resolver F — order ID 9, `TEST-RESOLVER-F-20260916-35126549387`, Workshop product-only case.
- Resolver G — order ID 10, `TEST-RESOLVER-G-20260916-35126549387`, three unresolved unknown-product lines.
- Manager RUN 1 disposable order `ORD-20260917121008-29FF0146`, unpaid, unsent, one Warehouse item.

Their exact current state may have changed. Observe first; do not assume.

## RUN 2 scenarios

### A1 — same resolver problem before and after entering Admin mode

Goal: inspect whether switching the existing simple Admin mode makes the current problem easier and predictable, or merely exposes a different internal tool.

Use Resolver D if still suitable.

1. Start in ordinary mode.
2. Open the order resolver.
3. Answer one manager-safe question (for example gender) but do **not** final-save if that would complete/send the order.
4. Enter simple Admin mode through the real UI **without inventing a new workflow**.
5. Observe:
   - does the same modal/state remain understandable?
   - is the locally selected answer retained or silently reset?
   - does the screen suddenly reveal unrelated admin actions?
   - is it obvious what Admin mode adds to this specific step?
6. Do not repeat this state-switch test on multiple orders.

Important: this scenario directly checks the awkward manager→Admin transition reported by the project owner.

### A2 — unknown product / zero-match Admin path

Use Resolver G if still unresolved.

Inspect only the first unresolved line deeply.

Questions:

- With zero suggestions, is the next action visually obvious without reading explanatory paragraphs?
- Can the admin search/select an existing product naturally?
- If no product exists, is “create new product” clearly separated from “search harder” and from “exclude/ignore this line”?
- Does the UI show the original manager input while the admin edits/chooses the canonical result?
- Does it explain what reusable catalog data will be created **before** the final mutation?
- Is there any easy escape hatch whose easiest effect is simply to make the warning disappear?

Do not complete all three G rows. One row is enough unless the sequential transition itself reveals a new class of problem.

### A3 — dangerous catalog escape hatches

Inspect, but avoid committing destructive/irreversible choices unless a disposable clone is needed.

Specifically find any Admin actions equivalent to:

- `Не добавлять в каталог` / exclude from catalog handling;
- `Оставить неизвестным` for gender/legacy cases;
- creating a new product/reference/variant from incomplete facts.

For each visible action ask:

- Is it visually presented as an exceptional action or as an equally easy normal button?
- Does the UI state exactly what consequence it has for stock/resolver/shipping?
- Can a tired admin use it merely to dismiss a problem?
- Is a supposedly “historical/legacy” escape available on an obviously current test order?

Do **not** propose removing legitimate legacy support yet; report observed reachability and presentation.

### A4 — Arrival in Admin mode

Return to `Склад → Операции → Приход`.

Use a known product such as `ОРАМАЛ` or one disposable position. Do not alter real physical counts.

Reproduce the RUN 1 partial-entry state:

- product entered;
- quantity not deliberately confirmed;
- color/size left unresolved where applicable.

Observe in Admin mode:

- Is the primary action enabled?
- Does Admin mode make an incomplete line look more valid than in working mode?
- Is there a visible distinction between “existing exact SKU” and “this save will create a new catalog combination”?
- Can you tell what will be added to catalog before pressing the primary button?
- If the UI offers a preview/review, is it concise and specific?

Prefer **not** to submit. If a single successful disposable master-data creation is absolutely necessary to understand the transition, use `TEST UX ADMIN 20260917 ...`, record every created value, and stop after one such mutation.

### A5 — Returns / exchanges: Admin-only corrections and cancellations

Do not manufacture financial data just for coverage.

Use existing history if present. Inspect the visible Admin-only controls around:

- cancelling a return;
- cancelling an exchange;
- correcting exchange financials;
- receiving a physically returned item / resolving where it goes if such an action is visible.

Questions:

- Is the difference between “correct data”, “cancel operation”, and “physical item arrived” obvious from button names/placement?
- Are money changes visually separated from stock/physical changes?
- Does a dangerous action have enough local context (order, amount, item) before confirmation?
- Are admin tools hidden until relevant, or is the user shown a control panel of internal operations?

If no suitable existing history exists, **do not create payments/refunds/exchanges** just to test this. Record “not testable without synthetic financial mutation” and move on.

### A6 — Finance / cash Admin controls

Inspect only; do not change cash state.

Look at Admin-only actions for the cash register / manual money adjustments / reversal or correction flows.

Questions:

- Can the admin immediately distinguish routine viewing from an action that changes money history?
- Is a reason/comment required or at least clearly prompted for manual corrections?
- Are destructive/reversal actions visually secondary and contextual?
- Does the screen expose implementation vocabulary that an admin must understand to use it safely?

Do not perform a money mutation.

### A7 — Admin catalog / reference maintenance

Briefly inspect the Catalog/References maintenance surfaces, but do not inventory every button.

Focus on whether the admin can answer three simple questions without reading long documentation:

1. What am I editing: a product, a reusable characteristic, or a concrete stock variant?
2. What existing orders/stock could this change affect?
3. Is this a normal edit, deactivation, merge/exclusion, or creation?

Stop after finding the first 2–3 materially different usability issues. Do not do an exhaustive catalog audit.

## What not to spend time on

- Do not re-audit navigation, clients, team, leads, plans, or basic Workshop list unless a tested scenario lands there naturally.
- Do not re-test basic create/edit order success.
- Do not repeat Reports M-08; code audit already confirmed the date-model contradiction.
- Do not benchmark performance.
- Do not inspect CSS/source code.
- Do not clean existing test fixtures unless the main agent explicitly asks later.
- Do not fix anything.

## Evidence / report format

Create:

`docs/audits/SYSTEM_UX_WALKTHROUGH_ASTRA_ADMIN_20260917.md`

Use compact findings IDs `A-01`, `A-02`, ... with:

- surface/scenario;
- severity (`HIGH / MEDIUM / LOW`);
- exact observation;
- shortest reproduction;
- why a tired real employee/admin can misunderstand it;
- evidence text/screenshot reference;
- **simplest direction**, not a patch plan.

Then add four short sections:

### Repeated root causes

Group findings that are the same underlying problem. Do not suggest one fix per screenshot.

### Things that are already clear

Record good parts that should not be redesigned.

### Operations intentionally not performed

List writes/money/stock actions skipped because they were unnecessary or unsafe.

### Handoff for code audit

List at most **5 code questions** the main ChatGPT agent should verify. Do not answer them by reading code yourself.

## Product lens

Assume the real users:

- do not want to maintain the system;
- ignore explanatory noise;
- act when something blocks the current job;
- do not know terms like canonical SKU, reference value, lifecycle event, variant identity;
- expect the application to guide the next action visually.

A good result is not “the admin can eventually find a powerful tool.”

A good result is: **the simplest visible action is the safe/correct action, and dangerous Admin capability appears only at the exact moment it is relevant.**

## Stop condition

Stop RUN 2 when all A1–A7 are either checked or explicitly marked untestable without unnecessary writes. Do not continue into implementation or a third exploratory sweep.