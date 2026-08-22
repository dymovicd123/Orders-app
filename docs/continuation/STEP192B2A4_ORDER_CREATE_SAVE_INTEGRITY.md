# STEP 192B2A4 — Order Create / Save Integrity

## Purpose

Emergency cumulative source hotfix for order creation and order-state persistence after Step 192B2A3.
The priority is that a valid order, especially Workshop work, cannot be lost or reported as unsaved because of a stock/readback/audit/retry defect.

## Main defects fixed

- Expected stock shortage is a structured 409 conflict instead of a generic 500.
- Frontend maps server shortage rows back to the correct original order rows and reuses the existing count-now / cannot-check-now flow.
- Workshop items never require Warehouse/Boutique availability.
- Orders may be created and later edited with zero payments; the full amount remains debt.
- Payment amount without a method, negative payments, invalid item quantities and invalid totals are explicit controlled input errors.
- Empty zero payment rows are not persisted or rendered as real payments.
- Workshop schema preflight now requires `workshop_tasks.order_item_id` before critical content writes.
- Create/edit are resumable critical operations with an immutable validated plan; retry does not rerun live shortage decisions after partial success.
- Pre-192B2A4 in-flight creates can resume from already-persisted order/order_items without self-blocking on their own reservation.
- Customer `orders_count` increment is retry-safe and customer creation is conflict-safe.
- Edit shortage checks exclude the edited order's own active reservations.
- Legacy inventory write-off/reversal paths are atomic D1 batches.
- Reservation-time concurrency is detected after the atomic reservation batch and surfaced to Warehouse Attention instead of producing a half-written order.
- Editor preserves hidden `unitPrice` and `audienceType`, avoiding false item rewrites and unnecessary reservation churn.
- Critical success boundary is now order/items/reservations/Workshop/payment/shipping mutation itself. Secondary `getOrder()`, manager audit and activity logs cannot turn a committed operation into a false failure.
- Manual debt payment is idempotent and cannot be duplicated by a lost response/retry.
- Shipping, stock handover, returns, exchanges, return/exchange cancellation and archive restore use safe post-commit readback behavior.
- Archive restore is naturally retry-safe after a lost response (`alreadyRestored`).
- Browser critical request IDs survive reload through `sessionStorage` without storing order/customer payload data.
- Successful frontend mutations clear their retry token before secondary dashboard refresh.

## Regression coverage

New `scripts/test-step192b2a4-order-create-save-integrity.mjs` checks the above invariants.
190.6A exact Worker declaration preservation has an explicit Step 192B2A4 allow-list (19 changed declarations + 9 additions, 0 removals).
190.6B exact frontend preservation has a separate Step 192B2A4 allow-list.
Older 189C and 192B2A tests were updated only where the new idempotent payment / structured shortage contracts intentionally replaced old expectations.

## Safety

- SOURCE ONLY.
- No migration.
- No D1 schema mutation.
- No installer D1 data mutation.
- Arrival UI is untouched.
- Primary and Branch 2 receive the same order-save source delta; Branch 2's separate `worker/domains/auth.ts` is not in the payload and must remain unchanged.
- Installer validates exact B2A3 baseline hashes (or exact already-applied B2A4 hashes), creates local backups, runs focused gates, full cumulative `release-check.mjs`, forced TypeScript and Clean Vite build on both roots before any deploy.
- If the Windows clean build fails, no deploy starts and local sources are restored.
- Live acceptance after deploy is read-only: health marker plus order-list GET. It does not create a fake production order.

## Install

From the Primary `orders-app` project root, after extracting this package there:

`\.\APPLY_STEP192B2A4_ORDER_CREATE_SAVE_INTEGRITY.cmd`

## R2 installer correction after first local preflight

The first R1 installer correctly aborted before any deploy because the Step 190.6C root-cleanup gate saw the active B2A4 launcher/context as historical root artifacts. R2 changes installer packaging only; the order-save business payload is unchanged. During pre-deploy release-check, a transient copy of the 190.6C test allows exactly the active `APPLY_STEP192B2A4_ORDER_CREATE_SAVE_INTEGRITY.cmd` when `STEP1906C_TRANSIENT_INSTALLER=STEP192B2A4_ORDER_CREATE_SAVE_INTEGRITY`. Immediately after both release gates pass, the installer restores the original strict 190.6C test before any deploy. The continuation context itself is stored under the internal step folder instead of project root. The launcher self-deletes only after a fully successful deploy + live read-only acceptance.
