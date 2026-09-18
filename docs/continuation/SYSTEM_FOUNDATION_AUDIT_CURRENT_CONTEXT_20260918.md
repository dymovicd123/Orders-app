# System foundation audit — current context (2026-09-18)

This file is the current continuation pointer for the Orders-app foundation cleanup.

## Repository / deployment guardrails

- GitHub repository: `dymovicd123/Orders-app`.
- Current Stage 0+1 implementation branch: `feature/stage01-truth-projections-20260918`.
- Current green Stage 0+1 head: `1499582f1ca1819f7e18971b1073cf45495f144a`.
- Production D1 has not been changed by the Stage 0+1 work.
- Branch2 is a separate environment and must not be casually folded into Production work.
- `Приход` remains a frozen/high-risk surface unless a separate approved task explicitly requires changing it.

## Why Stage 0+1 exists

The system accumulated several different notions of “what an order currently is”:

- money totals;
- return/exchange lifecycle;
- shipping/handover state;
- Workshop state;
- catalog identity;
- immutable order-time snapshots.

Historically, UI and API code sometimes used one coarse field as a proxy for another fact. That produces contradictions after corrections, returns, Resolver repairs, old imports and Workshop operations.

Stage 0+1 is creating explicit read projections so each surface consumes the correct truth without rewriting historical evidence.

## Completed slice A — operational order truth

`OrderOperationalProjection` now centralizes the operational read model used by ordinary order UI.

Key correction: historical `return_amount` is a money fact, not proof that a Return/Exchange workflow is currently active.

Workshop state now prefers concrete `workshop_tasks` and uses the old coarse order status only as fallback.

Order edit/ship/return/exchange/handover actions are derived from the same projection.

## Completed slice B — canonical item truth versus historical snapshot

`canonicalItemProjection` now gives working order rows their current canonical product/SKU after Resolver linking.

The original manager-entered identity is preserved in `originalSnapshot`.

Resolver remains link-based: it updates canonical foreign keys rather than rewriting historical snapshot text.

This is especially important for repaired old orders: current work should follow the catalog identity that the system has actually resolved, while audit/history can still answer “what was entered at the time?”.

## Validation state

The entire cumulative release gate and production build passed on GitHub Actions run `35327687377`.

Temporary PR #72 existed only to trigger CI and was closed without merge.

## Important distinction for the next audit

Do **not** convert every historical screen to canonical-first.

Use current canonical identity for a live/working operational order after Resolver repair.

Use immutable snapshots where the purpose is historical evidence, audit, old transaction description, or preserving what was entered at that time.

The next audit must classify each remaining read surface by purpose before changing it.

## Immediate next checkpoint

Audit remaining order-related code for duplicate truth derivations. The next implementation slice should be chosen from concrete contradictions found there, not from a broad rewrite.

See:
`docs/continuation/STAGE01_IMPLEMENTATION_CHECKPOINT_20260918.md`
