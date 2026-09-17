# System UX walkthrough — Astra handoff — 2026-09-17

## Purpose

This is a **GUI/product audit**, not a coding task. Walk through the live Branch2 application as a real employee would, identify where the interface or workflow is confusing, fragile, redundant, misleading, or unnecessarily technical, and record evidence for a later code audit.

Do **not** fix anything in this run. Do not refactor. Do not create a PR. Do not inspect the whole codebase unless a tiny code check is necessary to explain an observed GUI dead-end. The main analyst will inspect code separately after reading this report.

## Environment and safety

Repository: `dymovicd123/Orders-app`

Branch2 source baseline at start of this audit: `fb43e8d709b57b67cc080bb9bd64246bb036aede`

Branch2 application only:

`https://orders-app-branch2.orders-clothes.workers.dev`

Never interact with Production / the Primary Worker / Primary D1. Do not open the Production application to compare behavior. Do not modify `main` or `branch2` source. The audit branch exists only to store this handoff/report:

`audit/system-ux-walkthrough-20260917`

If the live Branch2 SHA no longer corresponds to the baseline, record the observed SHA/version if available and continue only if the URL is still clearly Branch2.

Use only disposable `TEST UX ...` data when new data is needed. Prefer reusing existing `TEST-*` Branch2 orders if they already cover the scenario. Do not create dozens of records. Aim for **at most 2–3 new test orders in the manager pass**. Do not use real customer names, phone numbers, payment details, or shipping data.

Do not use raw SQL to make a UI scenario possible. The point is to experience the application the way a user does. If a scenario cannot be reached through the UI, record that as a finding instead of manufacturing it in the database.

## Core product assumptions

The customer intentionally requested a very simple access model: ordinary mode plus a simple Admin mode. Do **not** invent roles, approval teams, notifications, task assignment, or complex RBAC.

Users are not expected to maintain the software. Assume they:

- do not read long explanations;
- ignore badges and informational notices unless the current task is blocked;
- do not remember to return to a separate maintenance queue later;
- do not know internal concepts such as canonical SKU, variant, execution, reservation, reference value, lifecycle event, or resolver state;
- expect the application to lead them to the next obvious action;
- may choose the easiest available escape path if it makes an irritating warning disappear.

A good workflow should therefore make the **easiest path the correct path**.

## What to look for

Do not judge only whether a button technically works. For each flow ask:

1. Is the next action visually obvious without reading a paragraph?
2. Is there one primary path, or several competing ways to do the same thing?
3. Does the page expose technical implementation concepts to the employee?
4. Can the user close/skip/bypass a problem and accidentally create inconsistent data?
5. Does the UI show one current truth, or stale/conflicting values in different places?
6. Does a default value look like a fact the employee deliberately entered?
7. If the browser is refreshed or the modal is closed, is important progress lost?
8. After an error, does the interface clearly show what to do next?
9. Are success marks/messages truthful about what is already saved versus merely selected locally?
10. Does an action have hidden side effects the user would not reasonably expect?
11. Is the same business problem represented by multiple unrelated screens or queues?
12. Does the user have to remember to visit another section later?
13. Is an admin-only action understandable in the existing simple Admin mode, without inventing a new role workflow?
14. Are there long texts that users will realistically ignore and that should instead be expressed by layout/state/actions?

## Cost / token discipline

This audit is intentionally split into **two runs**. Do not try to inspect the whole app in one session.

### RUN 1 — MANAGER ONLY

Execute only the manager pass below. **Do not enter Admin mode in Run 1.** Stop after the manager report is saved/returned.

### RUN 2 — ADMIN ONLY

Do not execute until explicitly asked in a later session. The main analyst will first inspect code and the manager report, then narrow the admin pass.

During each run:

- do not repeatedly reload pages unless needed;
- do not take screenshots of every normal screen; capture only evidence for meaningful findings;
- do not narrate every click;
- do not inspect source code broadly;
- group duplicate symptoms under one root finding;
- when a problem is obvious after one reproduction, move on;
- if a section looks clear and coherent, record `No material issue found` and leave it;
- stop rather than spending time trying to force a rare edge case.

## RUN 1 — manager walkthrough

Stay in ordinary/manager mode for the entire run.

### M1. Orientation / navigation

Start from a fresh page load. Without relying on prior knowledge, inspect the main navigation and answer: what would an employee think each section is for? Note unclear naming, duplicated destinations, excessive density, hidden primary actions, or places where the interface depends on explanatory prose.

Do not spend long here. This is a 5–10 minute orientation pass.

### M2. Create an ordinary order

Create one disposable ordinary warehouse order through the normal UI. Use an existing known product first so the happy path can be judged.

Observe:

- amount of information requested;
- defaults that may silently become facts;
- product selection and characteristics;
- payment fields;
- whether required/optional fields are visually obvious;
- whether saving gives a clear result;
- whether the row shown afterwards matches what was entered.

Then edit the same order once. Look for stale values, surprising resets, hidden restrictions, duplicate ways to correct the same fact, and whether editing feels like the same mental model as creation.

### M3. Send / resolver

Use an existing `TEST-RESOLVER-*` order if available; otherwise create at most one unresolved test order through the normal UI.

Test the resolver as a manager, including at least:

- unknown product / zero useful suggestions;
- known product with one ambiguous/missing attribute;
- closing and reopening the resolver;
- refreshing the page if there is partially completed local work;
- a multi-line unresolved order if an existing TEST order already provides one.

Pay special attention to:

- disabled controls with no obvious reason;
- whether `✓` means selected, validated, or actually saved;
- whether manager effort survives close/refresh;
- whether the interface unexpectedly reaches an admin-only dead end after making the manager answer many questions;
- whether the user knows what will happen to the order after the resolver finishes;
- whether a resolver action unexpectedly proceeds directly into shipping;
- whether the order row afterwards reflects the resolved product/attributes.

Do not enter Admin mode to finish an admin-only path. Record exactly where the manager gets blocked and what the screen tells them to do.

### M4. Workshop path

Inspect one workshop order/task path as manager if reachable without building extensive setup. Prefer an existing test order. Check:

- relationship between order and Workshop;
- what `ready` means to the employee;
- whether they know where to go next;
- whether product identification asks only information relevant to Workshop;
- whether order state and workshop task state ever appear contradictory.

If setup would be expensive, stop after the basic path and record the limitation.

### M5. Warehouse — daily manager work

This is high priority. Walk the warehouse surfaces available to manager mode as if you were trying to do normal daily work, not administer catalog internals.

Inspect the most obvious paths for:

- current stock overview/search;
- receiving/arrival if manager-accessible;
- moving stock between locations if manager-accessible;
- routine checking/stocktake entry points;
- `Нужно уточнить` / attention surfaces;
- opening an order from a warehouse problem;
- what happens when exact identity is missing and Admin mode is required.

Look especially for multiple overlapping screens that solve the same job, terminology users cannot understand, queues that can simply be ignored, warning text that replaces an actionable UI, and situations where physical stock versus reserved stock versus available stock is not visually clear.

Do **not** perform a full inventory rebuild or large stocktake. One harmless test interaction per relevant surface is enough.

### M6. Return and exchange

Using disposable Branch2 data, inspect one return and one exchange from the manager perspective. Reuse one test order if possible.

Focus on:

- how the employee discovers the action;
- whether it is clear what physical item is coming back / going out;
- whether money and physical stock are presented as separate but understandable consequences;
- whether cancellation/correction is discoverable without knowing internal terminology;
- whether the result is visible back on the order without contradictory status labels.

Do not exhaustively test every financial combination.

### M7. Payments / finance / reports — manager-visible surface

Inspect only what manager mode actually exposes. We are not auditing accounting mathematics in this GUI pass.

Check whether the employee can answer simple questions without interpreting implementation concepts:

- Is this order paid, partially paid, or unpaid?
- How do I add/correct a payment if allowed?
- Where would I look for today's money?
- What is the obvious difference between Finance and Reports?
- Do summaries agree visually with the order state?

If manager cannot access an area, record that and move on; do not switch to Admin mode.

## Manager-pass report format

Prefer one compact Markdown report. If repository write access is convenient, save it to:

`docs/audits/SYSTEM_UX_WALKTHROUGH_ASTRA_MANAGER_20260917.md`

on branch `audit/system-ux-walkthrough-20260917`.

If writing the repo is inconvenient, return the same Markdown directly. Do not modify application source.

Start with a 5–10 line executive summary, then a table with **only material findings**:

| ID | Surface | Severity | Observation / reproduction | Why a real employee gets stuck or misled | Evidence | Simplest direction |

Severity meanings:

- `BLOCKER`: cannot complete ordinary work or easy bypass can corrupt/lose operational truth;
- `HIGH`: likely confusion, wrong action, or recurring support request;
- `MEDIUM`: avoidable friction / duplication / unclear state;
- `LOW`: polish only.

After the table add four short sections:

### A. Repeated root causes
Group symptoms that appear to share one design/architecture cause. Do not propose ten patches for one cause.

### B. Things that were actually clear
List surfaces that should **not** be redesigned merely for consistency. We want less work, not more.

### C. Manager journey summary
For each M2–M7, mark `clear`, `friction`, `dead end`, or `not tested`, with one sentence why.

### D. Admin-pass targets
List only the admin screens/actions that the manager pass proved are worth inspecting in Run 2. Do not perform Run 2 yet.

## Advice policy

Your recommendations are useful, but keep them separate from observations. Prefer simplification directions such as:

- remove a duplicate path;
- make one existing action primary;
- persist a current workflow state;
- show the canonical/current truth instead of stale snapshots;
- replace explanatory text with a visible state/action;
- reuse the existing simple Admin mode at the exact blocked step;
- merge two screens that represent the same business problem.

Do **not** invent notification systems, new user roles, approval teams, complex permissions, chat/assignment workflows, or other infrastructure unless the existing product already has it.

## Stop conditions

Stop the run and report instead of burning time if:

- Branch2 is unavailable;
- the URL appears to be Production;
- a required Admin password is requested (Run 1 must not enter Admin anyway);
- a scenario would require raw DB manipulation;
- you hit the same underlying problem repeatedly;
- a destructive action cannot be confidently limited to disposable Branch2 data;
- the session becomes long enough that findings might be lost.

The goal is not exhaustive QA. The goal is to understand why the application feels difficult and where simplification will remove entire classes of future fixes.