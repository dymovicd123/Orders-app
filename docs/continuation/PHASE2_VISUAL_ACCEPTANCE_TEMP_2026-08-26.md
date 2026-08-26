# Phase 2 temporary visual acceptance fixture

Date: 2026-08-26
Branch: `branch2` only
Tested fixture source commit: `048c6094444873d0dc44c790f926e64f5a5621cd`

Purpose: render the Smart Daily Stock Truth cards safely even though the Branch 2 inventory database currently exposes no useful stock positions for visual acceptance.

Safety:
- no D1 seed, migration, repair, or cleanup is required;
- no Production/main change;
- Arrival / `Приход` is untouched;
- fixture activates only from the explicit URL query `phase2accept=1` or `phase2accept=blocked`;
- fixture variants use negative IDs and the quick-check function short-circuits them in-browser, so `Совпадает` / mismatch actions do not call the stock mutation endpoint;
- without the query parameter, Branch 2 continues to use its normal API/data path.

Visual acceptance modes:
- `?phase2accept=1` — five Warehouse examples / three Boutique examples, including normal, reserved and shortage states; one-tap match and mismatch are simulated locally.
- `?phase2accept=blocked` — active-revision blocker presentation.

After visual/mobile acceptance, remove the fixture before Production promotion. Production promotion must use the clean Phase 2 product delta, not this temporary acceptance-only code.
