# W8.3 — remaining daily Warehouse surfaces polish

Baseline: main `90d667d2c2d4e11bded93544e47cc540116c04c1` (W8.2). Branch: `w8-3-daily-surfaces-polish`.

This pass changes presentation only. History keeps exact-SKU context visible and identifies exact check rows. The recovery inbox keeps its existing derived data/actions but splits three identity-question origins visually. Operations and Stocktake were reviewed and intentionally left unchanged. Arrival is frozen.

No Worker/API/D1/migration, stock arithmetic, reservation, lifecycle or transfer runtime change. The Step1906B chain is extended with an exact W8.3 History+Attention manifest.

Next: final W8 cross-screen visual/mobile acceptance, then W9 full Warehouse audit/discussion.
