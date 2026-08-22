# Inventory view renderers

These files split the large `InventorySection` presentation without introducing new React lifecycle boundaries.

Rules:

- renderer functions are called directly (`renderInventory…Panel(ctx)`), not mounted as new components;
- renderers must not own React hooks;
- `InventorySection` remains the controller/state owner until the later typed view-model cleanup;
- the accepted `Приход` block stays byte-for-byte frozen in `InventorySection` and is injected into the movement renderer as `arrivalWorkspace`;
- Step 190.6B tests compare every extracted panel with the accepted 190.6A JSX and separately verify the frozen Arrival SHA;
- `InventoryRenderContext` is intentionally transitional; Step 190.6E should replace loose data fields with domain-specific view-model interfaces rather than adding new `@ts-nocheck` files.
