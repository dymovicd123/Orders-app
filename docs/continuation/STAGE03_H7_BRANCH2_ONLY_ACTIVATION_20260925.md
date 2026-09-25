# Stage03-H7 — Branch2-only itemized Create activation

Date: 2026-09-25

Status: **H7A safety baseline introduced. Runtime pricing activation is not part of H7A.**

## Non-negotiable environment rule

Until the whole system is explicitly approved for release:

- every improvement is developed on `branch2`;
- every deploy targets Worker `orders-app-branch2`;
- every remote D1 read/write targets `orders_db_branch2`;
- Branch2 D1 id is `40065052-854e-44b8-bcd5-251bdd488301`;
- Production Worker / Production D1 are not migration, test-data or deployment targets;
- any detected Production D1 binding in Branch2 must hard-fail before remote access.

No cross-database copy, fallback, comparison write, schema apply or test fixture is allowed.

## H7A purpose

Before visible `itemized_v1` activation, add a permanent safety gate that:

1. verifies Git branch is `branch2`;
2. verifies source Wrangler Worker and D1 identities;
3. rejects Production D1 identifiers;
4. runs H6I and H6J isolation regressions;
5. verifies TypeScript/build;
6. verifies the generated Wrangler deploy config still points only to Branch2;
7. performs a read-only Branch2 D1 pricing/schema fingerprint;
8. confirms visible Create is still legacy before the later activation commit.

H7A performs **no migration and no D1 business-row write**.

## Next engineering step after H7A is green

H7B/H7C will expose line-level sale pricing in the Branch2 Create form while preserving the confirmed rules:

- Catalog recommendation is current guidance, not historical truth;
- final sold price is explicit per line;
- missing Catalog price requires manual final price rather than blocking the sale;
- explicit final price 0 is valid;
- order total is derived from item lines;
- old orders stay `legacy_manual_total`;
- existing-order edit and itemized exchange remain fail-closed.

The unresolved discount / override-reason / return / exchange policies remain out of scope for activation.
