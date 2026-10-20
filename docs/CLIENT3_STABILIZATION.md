# Client3 / former client — clean, isolated, support-light release

**State (2026-10-20):** stabilization candidate in the `client3/isolated-stabilization-20261020` branch. **Not deployed and not approved for handoff**. Do not merge this tenant-specific auth change into active customer `main`.

## Scope and rules
- **Existing customer main:** Worker `orders-app` / D1 `orders_db_prod`. **Do not touch its data or configuration.**
- **Existing branch2:** Worker `orders-app-branch2` / D1 `orders_db_branch2`. **Do not repurpose its database.**
- **Third installation:** unique Worker named `orders-app-client3-...` and **new** D1 `orders_db_client3_...`, with an independent Cloudflare identity and no historical customer records.
- Generic cities, payment methods, colors, sizes and product characteristic dropdown references may be seeded from *public configuration defaults*; legacy manager names must not be seeded.
- No anonymized copy, clone or export of any existing client's order, customer, financial, inventory or personal data.
- Keep account sessions and one first-administrator credential. Do **not** make all admin APIs public or reenable header-based authentication.
- Third-only `CLIENT3_INSTALLATION=1` requires a strong `ADMIN_MODE_PASSWORD` Worker secret of at least 16 characters **before** first admin setup; the legacy `admin/admin` fallback must not work.
- No marketing/pricing feature reductions or changes to live business logic without acceptance tests. Prefer hiding only demonstrably unnecessary UI after requirements confirmation.

## What has been verified by direct repo review (not a blanket runtime guarantee)

| Priority | Concern | Evidence / guard | Exit criteria |
|---|---|---|---|
| P0 | Reusing main/branch2 DB or worker | main wrangler binds prod D1; branch2 has its own D1; client3 generator refuses protected IDs / names | Client3 config has exactly one unique D1 binding; no prod/branch2 mutations |
| P0 | Legacy client names in supposedly empty DB | `migrations/0002_reference_values.sql` seeds seven managers | Client3-generated copy excludes manager seed; fresh schema test finds 0 managers/orders/customers/payments/variants/stock/users |
| P0 | First-admin account takeover | Existing `getAdminModePassword` defaults to `admin` on ordinary installs | Client3 gate refuses absent/short/default bootstrap secret; live login and unauthorized 401/403 smoke |
| P1 | Catalog resolver: known SKU but absent reserve | Production #1775; PR #513 resolved empty-dialog path | Unsaved reservation recovers without inventing physical stock; no duplicate reservation; exact client3 API acceptance |
| P1 | Resolver wrong variant / retired / gender unknown | Historical male Ai-Nazik and Bayan SKU mismatch; gender-related regressions present | Explicit SKU choice, preserve actual variant and history, no phantom stock |
| P1 | Exchange / return / shipment coupled to reservations | Return #1563 with active reservation for completed returned lines; older linked-order and post-stocktake incidents | After real item return, no stale active reserve for returned qty; no double restock; repeated/cancel requests idempotent |
| P1 | Money integrity across exchange, refund, debt | Orders 1734/1974 duplicate and cascaded exchange-history incident | Payments sum and debt consistent; no double payment or refund; admin delete previews effects |
| P1 | Stale stock and mixed-source orders | Past source-switch cache, stock 0 with active reserve, issue vs revision | Counts update across warehouse/boutique; stock and reserves don't silently change on order read |
| P1 | Database fresh install from many historical migrations | 112 migration files, including feature additions and journals | Full empty-schema migration simulation and integration smoke; no failed migration |
| P2 | Operational complexity / long incident handling | Old production has extensive admin tools and customizations | Remove only objectively unused views; new client gets a short operating manual |
| P2 | E2E blind spots | Many source-level assertions, but they don't prove complete live flows | Exercise real Worker + new D1 with fixture orders before handoff |

**Important:** Production user incidents are not necessarily reproducible on an empty DB, but the same code paths are included. Empty data by itself does **not** fix logic defects. Do not claim the third installation is stable until the E2E acceptance matrix below is green.

## Independent installation procedure (explicit human-approved execution only)

1. Check out `client3/isolated-stabilization-20261020` (do **not** deploy `main` or `branch2`).
2. Run `npm ci`, `node scripts/client3/test-fresh.mjs`, `node scripts/client3/stability-gate.mjs`, `npm run typecheck`, `npm run build`.
3. Create a **brand-new** Cloudflare D1 database named `orders_db_client3_old_client`, and record its newly assigned UUID. Do not restore or clone another D1.
4. Run `node scripts/client3/prepare.mjs --prepare-migrations` (this generates separate .client3-migrations, not the protected root migration history).
5. Run `node scripts/client3/prepare.mjs --configure orders-app-client3-old-client orders_db_client3_old_client <NEW_D1_UUID>`.
6. Run `node scripts/client3/prepare.mjs --validate`. Confirm a single DB binding and a brand new UUID distinct from main/branch2.
7. Apply **only** the isolated migrations with `npx wrangler d1 migrations apply orders_db_client3_old_client --remote --config wrangler.client3.json`. Run SELECT-only checks of empty business tables, foreign keys and expected reference counts before public access.
8. Deploy using `npx wrangler deploy --config wrangler.client3.json`. Even if an URL becomes public at this step, Client3's fail-closed bootstrap gate stops first-admin creation without its Worker secret.
9. Provision a **strong unique** `ADMIN_MODE_PASSWORD` via Cloudflare Worker secret (never put it in Git, PR descriptions or logs). Create the first administrator through the initial setup flow; log out/in and confirm manager/admin separation.
10. Run complete E2E fixture acceptance on third DB only. **Before handoff**, delete only the known fixture orders using supported business deletion, then SELECT-verify every affected orders/payments/reservations/movement table is clean. If this cannot be proven, discard and recreate the entire isolated third D1; never manually wipe a live/customer DB.

The above commands are operational documentation; scripts provided here do not create databases, deploy anything, or mutate the two existing installations. **No third Cloudflare worker or D1 is presumed to exist.**

## Minimum E2E acceptance before handoff

- New D1 is genuinely empty: managers and users 0, products and stock 0, customers and orders 0, payments 0; first admin only after secret bootstrap.
- Anonymous request to `/api/orders`, `/api/payments` denied; admin protected operations deny manager role.
- Create standard order with a precise variant and payment; totals, ledger and debt match.
- New unrecognized variant: resolver shows affected item; user chooses exact SKU; no unrelated SKU learned, physical stock not fabricated.
- Known exact SKU but missing pending reservation: recovery creates exactly one reserve; reattempt doesn't duplicate it; physical stock unchanged until legitimate movement.
- Warehouse and boutique switch immediately refreshes physical/reserved/available without silently merging sources.
- Order shipped with sufficient stock (one subtraction only); shortage confirmation (no fabricated arrival); repeated send cannot double decrement.
- Complete / partial exchange, return to physical stock, cancellation and repeat request; correct reserved_quantity and no over-restock.
- Change price before/after exchange; payments, refunds and debt remain internally consistent and traceable.
- Stocktake after an older order, negative availability, and historical issued-before/after checkpoint; no duplicate physical movement.
- Refresh, navigation, timeout and retry after successful write: no double payment, reserve, stock subtraction or duplicate exchanged item.
- Role changes, first admin password change, session expiry; error messages identify the **actual** failed step.

## Release / rollback

- Gate failures: **no deployment**.
- Deployment errors: restore previous Worker version, preserving independent third D1; never point third Worker at another customer DB.
- Data corruption or unexplainable finance / stock results during fixture acceptance: recreate fresh third database instead of force-adjusting balances.
- Launch with a known date/version; freeze third release except high-priority patches and test them on an independent scratch DB first.
