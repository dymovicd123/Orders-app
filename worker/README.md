# Worker architecture

Step 190.6A turns `worker/index.ts` into the composition root. Business logic belongs in modules below it.

## Layers

- `core/` — environment/types, HTTP helpers, text normalization, shared SQL helpers, app settings. `core` must not import `domains`.
- `domains/` — business capabilities grouped by responsibility: auth, catalog, orders, inventory, workshop, returns/exchanges, finance, storage, team, imports.
- `index.ts` — request routing/composition only. Do not put substantial business workflows back here.

## Dependency rules

1. No module may import `worker/index.ts`.
2. Circular imports are forbidden.
3. Cross-domain dependencies must follow the existing directed graph; shared primitives should move downward into `core/` or a narrow shared domain module instead of creating a cycle.
4. D1 write behavior, status codes and business invariants must not be changed during structural moves.
5. Before moving an existing Worker declaration, update the Step 190.6A declaration-manifest only in a dedicated behavior-changing step. The manifest is intentionally frozen for this structural refactor.

## Release guard

`scripts/test-step1906a-worker-modularization.mjs` enforces:

- composition-root size;
- required module boundaries;
- no `@ts-nocheck` in Worker code;
- no oversized Worker module regression;
- all 577 pre-1906A declarations retain their original bodies;
- router remains identical except for the 190.6A health marker;
- no circular imports and no domain -> index dependency.
