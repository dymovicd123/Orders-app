# Stage03 Production Catalog price editor release

Date: 2026-09-22

Production migration 0072 was applied before UI promotion and verified with an unchanged aggregate finance fingerprint.

Promoted UI source is the visually accepted Branch2 Stage03-C/C1/C2 state from commit:
`3831c51e388e525323eff7fe5de040e7f6eb5153`.

Scope:
- admin-only Catalog price editor;
- current cost + sale price per execution + adult/child;
- responsive and visually integrated pricing strip;
- exact-SKU full-row layout repair.

Not in this release:
- order autofill;
- itemized pricing;
- discount behavior;
- Production migration 0073;
- Finance/report changes;
- Return/Exchange price automation.

Environment files were not copied from Branch2. Production keeps its own `wrangler.jsonc`, title, package/environment gate and Production D1 binding.
