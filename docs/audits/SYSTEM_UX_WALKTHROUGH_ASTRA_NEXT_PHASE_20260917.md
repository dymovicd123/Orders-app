# Astra next phase — lifecycle truth + warehouse usability — 2026-09-17

## Status and purpose

This file is the **current handoff for Astra**. It supersedes the broad idea of doing another full-app walkthrough right now.

The main ChatGPT agent is doing the architecture/code audit. Astra's role is narrower: **act as a real employee in the live Branch2 UI and provide black-box evidence about whether the application preserves and communicates business truth across real workflows.**

Do not redesign the architecture. Do not inspect source code. Do not fix anything.

Branch2 URL:

`https://orders-app-branch2.orders-clothes.workers.dev`

Expected Branch2 code baseline:

`fb43e8d709b57b67cc080bb9bd64246bb036aede`

Repository:

`dymovicd123/Orders-app`

Audit branch containing context/docs:

`audit/system-ux-walkthrough-20260917`

**Production is forbidden.** Do not open/mutate Production for comparison.

---

## Read before starting

Read only these docs; do not crawl the repository:

1. `docs/audits/SYSTEM_UX_WALKTHROUGH_ASTRA_MANAGER_20260917.md`
2. `docs/audits/FOUNDATION_AUDIT_HYPOTHESIS_20260917.md`
3. `docs/audits/MANAGER_CODE_AUDIT_01_M01_M04_20260917.md`
4. `docs/audits/MANAGER_CODE_AUDIT_02_M05_M07_20260917.md`
5. `docs/audits/MANAGER_CODE_AUDIT_03_M08_20260917.md`

The earlier `SYSTEM_UX_WALKTHROUGH_ASTRA_RUN2_ADMIN_20260917.md` remains useful background, but **do not execute the whole A1-A7 sweep in this run**. The current priority is Return/Exchange lifecycle truth. A separate Admin sweep can be resumed later only if the main agent asks.

---

# Your role

Pretend you are an ordinary employee using the application to finish today's work.

You are **not** a developer, architect, QA automation engineer, or business-process designer during this run.

The questions to keep asking are:

- What just happened in the real world?
- What does the UI now claim happened?
- After F5/reopening, does it still claim the same thing?
- Do other screens agree?
- Is the next action obvious without understanding internal architecture?

Do not judge a screen mainly by visual beauty. Focus on whether the user can maintain a correct mental model of the order, money, physical item, and stock.

---

# Critical product constraints

The customer intentionally uses a **simple working mode + simple Admin mode**.

Do not recommend or invent:

- accounts/complex roles;
- approval queues;
- proposal inboxes;
- notification workflows;
- “call administrator” / “request approval” mechanics;
- new organizational procedures.

If Admin mode is required by the existing application, use the existing Admin mode only.

The real users:

- ignore explanatory noise;
- do not want to maintain the system;
- act when the current job is blocked;
- do not know terms like canonical SKU, lifecycle event, variant identity, reference value;
- expect the simplest visible action to be the safe/correct one.

---

# Cost and session discipline — mandatory

Astra previously exhausted a five-hour quota. Do not repeat that.

## Phase 1 hard budget

- Target: **60–75 minutes maximum** of GUI work.
- Do only Return/Exchange lifecycle tests described below.
- When Phase 1 is complete, **STOP and write the report**.
- Do not continue into Warehouse Phase 2 unless the main agent/user explicitly says to continue.

## General limits

- No source-code browsing.
- No GitHub archaeology beyond reading the five docs above.
- No Production.
- No performance benchmarking.
- No exhaustive full-app navigation.
- No screenshots of every page; capture only evidence for meaningful transitions/findings.
- Do not keep reproducing the same problem after it is proven once.
- Prefer existing clearly disposable TEST records.
- If new test data is required, create only the minimum needed to exercise the lifecycle.
- Maximum new disposable orders in Phase 1: **2**.
- Maximum successful Return operations: **2**.
- Maximum successful Exchange operations: **1**.
- Maximum cancellation/reversal test: **1 operation**.
- Do not clean up the test records afterward. Record their IDs/external IDs so the code audit can inspect them.
- Never guess Admin credentials. If Admin mode is needed and cannot be entered normally, record the blocker and continue with manager-observable parts.

If the system behaves unexpectedly after a write, **stop that scenario and document it**. Do not click repeatedly trying to “fix” it.

---

# Safety rule for writes

Branch2 is an isolated test environment, so controlled test mutations are allowed **only on disposable records**.

Before performing a write, confirm visually that you are on the Branch2 URL.

Do not alter:

- real-looking customer orders;
- real-looking payments;
- real-looking stock merely to create test coverage.

Use existing TEST fixtures or new names beginning with something obvious such as:

`TEST UX LIFECYCLE 20260917 ...`

If a financial amount is necessary for a valid disposable Return/Exchange, use the smallest straightforward test amount that the normal UI accepts. Do not create multiple artificial money operations just to populate a report.

---

# PHASE 1 — Return / Exchange lifecycle truth

## Why this is the priority

The application now distinguishes the financial operation from the physical returned item:

- money may already have been refunded;
- the old/returned item may still be in transit;
- later it may physically arrive;
- after arrival it may go to Warehouse, Boutique, or be received without going back to sellable stock.

This is an important architectural direction, but RUN 1 did not execute the full lifecycle. We need black-box evidence that a normal person can follow it and that all relevant screens remain consistent.

## Scenario R1 — Return now, physical item later

Use an existing disposable order that is suitable for a real Return. Prefer one that is already paid/issued enough for the normal Return workflow.

If no suitable TEST order exists and the path is straightforward, create **one minimal disposable test order** through normal UI. Do not force a complicated fixture if ordinary UI cannot create the prerequisite quickly.

Perform one Return containing one physical item with the item state:

`Ещё не пришёл`

Use a valid non-zero refund amount if the operation requires money.

Immediately record:

- order external ID;
- Return ID if visible;
- product/item;
- refund amount and method;
- physical state selected;
- what the success state says.

Then:

1. Reload the page (F5).
2. Re-open Return history without relying on browser back-state.
3. Find the same Return.
4. Record whether it still clearly says the money operation happened but the item has not arrived.
5. Visit the order surface and note whether its money/status agrees.
6. Visit Warehouse/stock only far enough to see whether the item was incorrectly restored before physical receipt.

Do not assume what should happen from implementation terminology. Describe what the UI makes you believe happened.

## Scenario R2 — Physical receipt after the Return

Continue the same R1 operation.

Use the existing UI action equivalent to `Товар пришёл` and send the item to **Warehouse** if allowed.

After the action:

1. Record the immediate success/status text.
2. F5.
3. Re-open the Return history.
4. Confirm whether the returned item now reads as physically received and whether the Warehouse destination is still explicit.
5. Check the relevant Warehouse stock view once.
6. Note whether the quantity appears exactly once, not zero times and not twice.
7. Navigate back to the order/Return history and note whether all surfaces tell the same story.

Do **not** repeatedly click receipt if the state looks uncertain. If the first action appears ambiguous, stop and report.

## Scenario R3 — Received but intentionally not returned to sellable stock

Only run this if it can be done without creating a second complicated fixture.

Use a second disposable Return/item and choose the equivalent of:

`Пришёл, в остаток не добавлять`

After F5, answer only these questions:

- Is it unambiguous that the item physically arrived?
- Is it unambiguous that it did **not** return to sellable stock?
- Does Warehouse avoid counting it as available stock?
- Does history preserve the distinction after reload?

If this would require too much setup, mark it `NOT TESTED — setup cost too high` and move on.

## Scenario E1 — Exchange: new item goes out while old item is still returning

Use one suitable disposable order/fixture. Prefer an exchange with an **existing known SKU** as the replacement to avoid catalog/resolver noise.

Set the old item to:

`Ещё не пришла`

Complete one Exchange through the normal UI. Prefer zero financial delta if the UI naturally permits that; otherwise use the smallest valid disposable financial delta and record it exactly.

After saving:

1. Record what the UI says happened to the **new item**.
2. Record what it says about the **old item**.
3. F5.
4. Re-open Exchange history.
5. Verify that the old item is still visibly pending while the new item has its own issued/source state.
6. Briefly inspect Warehouse stock for the new item/old item to see whether the physical interpretation matches.

Then, if the UI exposes it naturally, mark the old item as physically returned to Warehouse or `no_stock`.

F5 again and verify that the Exchange history still tells a coherent two-sided story.

## Scenario C1 — One cancellation/reversal after real side effects

This is the highest-value destructive test, so do it **only on one disposable operation created/identified in this run**.

Prefer cancelling the Return from R1/R2 **after** it has produced both:

- a financial refund; and
- a physical Warehouse receipt.

If the normal UI does not allow cancellation, or cancellation requires risky unrelated setup, do not force it.

If you can safely cancel it:

1. Before cancellation, note refund amount and current Warehouse quantity for the tested SKU.
2. Use the normal cancellation action once.
3. F5.
4. Check Return history/status.
5. Check the order's financial state.
6. Check Warehouse stock for the tested SKU.
7. Record whether the cancellation clearly reversed both money and stock effects, or whether one dimension remained behind.
8. Do not attempt a second cancellation/retry if anything looks wrong.

This scenario is not about whether the confirmation dialog looks nice. It is about whether one business reversal leaves one coherent truth across the system.

## Scenario X1 — Admin correction vs physical receipt vs cancellation

If Admin controls are available naturally on Return/Exchange history, inspect them briefly after the scenarios above.

Record whether a person can clearly distinguish:

- changing/correcting financial data;
- cancelling the business operation;
- marking a physical item as received.

Do not perform extra financial corrections just for coverage. One actual cancellation/reversal test is enough for this phase.

---

# Cross-surface consistency checklist for every Phase 1 scenario

After each meaningful transition, use only the screens relevant to that event and compare the story they tell:

1. Order/list or order details.
2. Return/Exchange history.
3. Warehouse stock view when physical quantity should or should not change.
4. Finance/report only if the operation naturally produces a money effect visible there.

A finding is especially important when two screens are individually plausible but contradict each other.

Record the contradiction exactly; do not diagnose code.

---

# Mandatory refresh test

For every completed business transition in Phase 1, do at least one **F5/re-open** before deciding the state is correct.

We explicitly care about the difference between:

- local React state;
- persisted server state;
- derived state after reload.

If something looked correct before F5 and different afterward, treat it as a major finding.

---

# What counts as a finding

Prioritize findings where:

- the UI makes a successful operation look unfinished;
- an unfinished operation looks completed;
- physical receipt and stock are confused;
- money and physical return are visually conflated;
- an action disappears after reload;
- another screen tells a different story;
- the user must understand internal implementation language to know what to do;
- the safe next action is not the obvious next action;
- cancellation corrects only one dimension of the operation;
- a repeated click appears necessary/tempting because success is unclear.

Do not create a separate finding for every awkward sentence or spacing issue unless it actually causes workflow misunderstanding.

---

# Phase 1 report format

Create:

`docs/audits/SYSTEM_UX_WALKTHROUGH_ASTRA_LIFECYCLE_20260917.md`

Start with a **test data ledger**:

| Record | External/operation ID | What was changed | Final observed state |
|---|---|---|---|

Then write findings as `L-01`, `L-02`, ... Each finding must include:

- scenario (`R1`, `R2`, `R3`, `E1`, `C1`, `X1`);
- severity (`HIGH / MEDIUM / LOW`);
- exact observed UI behavior;
- shortest reproduction;
- state **before F5**;
- state **after F5**;
- other surfaces checked and whether they agreed;
- why a normal tired employee could form the wrong mental model;
- evidence/screenshot reference;
- simplest product direction in one or two sentences, **without designing architecture or code**.

End with exactly these sections:

### Lifecycle that already feels coherent

Record parts that should not be redesigned.

### Cross-surface contradictions

Only contradictions where two surfaces disagree about the same real event.

### Untested because setup would be wasteful/risky

Be explicit. Do not burn quota to chase 100% coverage.

### Handoff questions for code audit

Maximum **6 questions** for the main ChatGPT agent. Phrase them as factual questions to verify in code/data, not proposed fixes.

### Stop point

State that Phase 1 ended and do not continue to Warehouse Phase 2.

---

# PHASE 2 — Warehouse stock-browse usability (DO NOT RUN YET)

This phase is prepared now so context is not lost, but execute it **only after the user/main agent explicitly says `continue to Warehouse Phase 2`**.

Target budget: **30–45 minutes**, read-only if possible.

The goal is not to redesign Warehouse. The goal is to convert the owner's vague feeling “Остатки всё ещё чем-то напрягают” into observable questions.

## Employee/owner questions to answer using the current UI

Choose 2–3 existing products that naturally have some variety. Do not manufacture stock just for this pass.

For each selected product, try to answer without reading source/docs:

1. How many physical units are here now?
2. How many are reserved/in orders?
3. How many are actually free to sell?
4. Which colors are present?
5. Which sizes exist inside each color?
6. Can I tell at a glance which color/size combination is running out or overstocked?
7. Can I tell why a quantity is unavailable (reserved vs physically absent vs unresolved)?
8. If I wanted to understand whether this assortment item is “stagnant”, does this screen help at all or force me into unrelated screens?

Measure only practical friction:

- number of expansions/clicks;
- having to remember values while moving between views;
- labels that describe storage internals instead of a business question;
- information that is technically present but visually hard to compare;
- multiple screens needed to answer one simple stock question.

Do not propose profitability formulas or new price/cost UI in this phase. Those require the architecture audit first.

Create later:

`docs/audits/SYSTEM_UX_WALKTHROUGH_ASTRA_WAREHOUSE_BROWSE_20260917.md`

Use finding IDs `W-01`, `W-02`, ... and stop after the first 4–6 materially different issues. Repetition is evidence, not a reason to create 20 findings.

---

# Things Astra must NOT decide

Do not decide:

- the final architecture;
- whether the system needs a rewrite;
- where price/cost should be stored;
- FIFO vs weighted-average costing;
- how Workshop supplier debt should be modeled;
- whether a catalog item should be deleted vs retired;
- whether future profitability formulas are correct;
- whether a manager/admin role system should be expanded.

Those are main-agent/business decisions after evidence is collected.

Astra may report that the current UI makes one of these areas confusing, but must not turn that observation into a large redesign proposal.

---

# Final operating rule

The purpose of this run is **not to find as many bugs as possible**.

The purpose is to determine whether one real-world event has one stable meaning throughout the application.

Whenever possible, prefer one deep end-to-end scenario with reload/cross-screen verification over five shallow screen inspections.