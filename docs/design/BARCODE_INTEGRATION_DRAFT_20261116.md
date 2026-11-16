# Barcode integration (DRAFT) · Orders-app · 2026-11-16

**Status:** architecture and workflow preparation ONLY; depends on staff process answers, label/printer decision, owner approval and Branch2 validation. **No runtime implementation, database migration or Main/Branch2 deployment is authorized by this draft.** Based on Main commit 28830a500ef3ef1005c1c347807ed8817c07bb56.

## 1. Verified existing architecture

- The authoritative physical count is inventory_stock.quantity per inventory_source + variant_id. Active reservations are inventory_reservations (not physical deductions until issue). Order-source-picker selects an active exact SKU, source, quantity and price; it must not select a serial identity.
- Catalog creates variants via catalog.ts; an actual catalog variant_id is produced before any physical stock is required. Arrival can create genuinely missing canonical catalog entities through inventory-arrival-materialization.ts; arbitrary order create must not mint fake SKU stock. Duplicates are normalized, retired/execution generations and merged identities have special safeguards.
- inventory-movement.ts handles arrival, manual_set, writeoff and transfer, with request fingerprints/idempotent docs. inventory-stocktake.ts handles exact counts and latest physical check freshness.
- order-dispatch.ts / order-shipment-plan.ts handle confirmed shipping, fulfillment, shortages, partial issues, prior issues and legacy orders through order_dispatches / order_dispatch_items. Modern and historical shipment lineage must NOT be conflated.
- Workshop completion is not Warehouse receipt. Workshop products can be built for a particular order and handed directly to client.
- order-returned-item-receipt.ts separates physical receipt from contract/refund, can apply lifecycle stock-in or preserve pending, and prevents double count after later stock check. Return V2 has separate gated routes and immediate-intake path; protect both V1 and V2 until feature-state resolved.
- catalog-retirement.ts can retire product/execution and zero physical quantity, release active reserves, keep historical SKU. catalog-variant-consolidation.ts merges canonical equivalents, with stock/reserve journal. Some exceptional catalog.ts repairs remap variant_id on existing relations; barcodes must not assume variant_id never changes.
- Roles: authenticated admin/manager + employeeRole 'Завсклад'; selected warehouse endpoints extend supervisor authority, some inventory operations currently allowed managers. New operations must check server-side account and employee role, not UI or user-supplied headers.

## 2. Separation of identities (proposed)

1. SKU = catalog_variants.id (logical exact model/execution/color/size/gender/category).
2. Physical unit = immutable unit_id, *optional* at initial rollout, has logical SKU (resolved active generation) + original SKU provenance + physical state/source/operation lineage.
3. Encoded label token = revocable/mappable code pointing to unit_id; NOT SKU name, order ID, price or permanent physical stock count.
4. Optional SKU-code = separate prefix/category for catalog selection/shelf label; it can select a SKU but NEVER proves one physical unit has been touched.
5. Scan only authorizes after authenticated Worker validates current SKU, label validity, unit state, source, order line, chosen operation and atomic requestId.

**Important:** A new catalog product/variant automatically receives a stable SKU code (derived from immutable unique variant ID or explicit code registry), with no zero-stock physical unit minted. Only actual arrival, received workshop piece, conversion of pre-existing physical piece or verified returned piece creates unit records/individual labels. Label printing itself makes NO stock movement.

**Suggested labels:** U code for individual physical unit in Code 128, short opaque unique payload, printable human attributes (product, color, size, execution material/length as relevant), tiny readable unit ID; do not print personal/client/financial info. A different S prefix can be used for SKU-only lookup/shelf print. Do not treat internal Code 128 as retail GTIN/GS1/EAN registration.

## 3. Additive database (proposed conceptual tables)

- barcode_sku_codes: variant_id, code, created_at, generation/status, unique active constraints. Retired variants remain historical; fresh generation gets a new code.
- inventory_units: unit_id, original_variant_id, canonical_variant_id, source_type (warehouse/boutique/workshop/not-in-stock), current_state (draft_label / present / workshop_received / issued / returned_pending / awaiting_verification / not_stock / retired), source_operation_type/id/line, created_at, updated_at, version. Create only for real observed pieces, never for a fake catalog stock position.
- inventory_unit_labels: token, unit_id, version, active/invalidated, issued_at, invalidated_at, reason, created_by, unique active token; reprint / replacement semantics are distinct.
- inventory_unit_events: append-only unit transitions, actor, source, operation id, order_item_id, dispatch_item_id, return_item_id / exchange_item_id / transfer_item_id, prior/next state and idempotency. Unique operation+line+unit+action for replays.
- barcode_print_batches: set of frozen labels/templates from an actual intake/print action, requested_by, claimed_print, print_count, reprint reason. **Printing success is never assumed**: browser print can't prove that a label was attached; optional scan verification is the evidence.
- Optional unit-to-operation-link table if a unit event alone cannot represent multi-unit line bindings.

All tables additive, strongly indexed by token, unit_id, active variant+source+state, operation key, order_item and print batch. Avoid D1 one-query-per-unit loops for 50+ labels; use batches and guard read/write budgets.

**Authority:** existing inventory_stock and inventory_reservations remain sole quantitative/obligation truth. Unit ledger is a *coverage and provenance* layer, not independent arithmetic that adds/subtracts physical totals.

For each SKU/source, show “physical=Q; unit labels currently verified=M; unmarked/unverified coverage=Q-M” only where M is reliable and <=Q. If a correction/return/retirement breaks coverage, show mismatch/unknown coverage, not a negative phantom quantity or fabricated automatic unit movements. No live-operation blocking merely due to unmarked legacy goods.

## 4. User workflows (each inside existing workspace)

### A. Arrival from Kyrgyzstan

Receive/identify canonical SKU and quantity through current Arrival. Print optional labels in the same form, with prepared draft print batch. The **real arrival is committed exactly once** with current inventory operation request ID, independently of printer state. When labels are scanned/attached, bind them as evidence to the same receipt without a second +Q. If printer unavailable, submit real arrival now with “needs labels” and later print directly from receipt. Double click/retry cannot create duplicate stock or new unit IDs. If catalog variant is genuinely missing: resolve/create safely using existing arrival materialization; if previously retired, run existing explicit recovery, not a silent variant resurrection.

### B. Existing unmarked stock

From SKU card / stocktake / scan workflow: verify item+source, generate/attach unit label **without arrival**, decrement only “unmarked coverage” (derived), leave inventory_stock.quantity unchanged. During phased adoption some products have labeled units and unlabeled units; both must still be sellable under existing guarded flow. Do not generate phantom units for the whole historical stock count before actual marking. Old discrepancies need explicit physical checking to claim coverage is reliable.

### C. Workshop

Manufacturing "done/ready" alone does not add warehouse stock. When the person who actually receives the piece from workshop physically handles it: optionally attach unique label bound to order/workshop task and mark “received for dispatch”, not +warehouse stock. Direct shipping without a label remains a guarded exception; no missing-label pretext for stock movement. If refused/left unused, retain workshop obligation/payment fact, track physical disposition separately. Staff interviews should define who receives pieces, whether handover occurs at workshop or with logistics.

### D. Create/edit order

Keep exact-SKU/source/qty picker and the existing absence/reservation rules. Never require manager to choose a unit_id/serial while promising a sale. The order draft's SKU is authoritative; label assignment occurs at the moment of real physical pick/dispatch. No implicit edit to paid prices/snapshots when scanning. Unresolved reserve remains unresolved until exact SKU and physical proof are known; barcode scanning is not automatic reservation issuance.

### E. Dispatch, partial issue and cancellation

The shipment workspace initially selects all currently ready lines as now. Scan physical U-label(s): server checks active token, exact canonical SKU vs order line, source, unit availability, previous dispatch and duplicate within this action. Bind unit IDs to the existing dispatch/order_item/quantity *in the same guarded critical operation* as reservation fulfill and inventory movements. Without labels, retain existing confirmed physical-hand-over path, evidence clearly “unmarked”. For prior-issued legacy orders, confirmation must not perform second writeoff. Undo/cancel uses existing correction lineage; any unit reappears in stock only if actual physically returned, not simply because dispatch status was cancelled.

### F. Returns, exchanges and lost labels

Keep refund/contract separate from receiving piece. Physical receipt accepts scanned U-label or “No barcode”; in no-code case confirm origin order/SKU via actual garment attributes, then bind/print new unit only where physically observed. Preserve historical original sale SKU, actual received replacement SKU and disposition (warehouse, boutique, no_stock, pending). Never +1 on print, reprint, or already-counted stocktake. For known unit with damaged label: revoke compromised token/reissue one active token mapped to SAME unit; for physically indistinguishable multiple sold pieces: do not claim an exact original unit, create replacement unit identity with ambiguous-origin provenance, limited by contract return quantity. Exchange = TWO different physical legs, old inbound and new outbound; do not conflate labels, stock movement or money.

### G. Transfer, writeoff and stocktake

Transfer uses existing source-to-source documented move; scanned items are explicit unit IDs, server applies existing SKU stock movement once, then unit state/source changes atomically. Unmarked rows use exact SKU+count and current human confirmation. Writeoff must bind labeled units or leave corresponding unit coverage unknown; printing a different label never makes stock reappear. Stocktake counts scanned unique valid IDs plus manually counted unlabeled goods, then commits only once through existing stocktake. Scanned mismatches, extra units and missing labels are shown during the count, not silently auto-moved/auto-received. Latest stocktake and freshness rules for delayed returns remain authoritative.

### H. Catalog edit / retire / consolidate / restore

Ordinary name display changes can update label layout, not label ownership. A real identity change affecting variant with active units requires explicit per-unit canonical redirect or a new generation plus controlled relabel, never a silent reinterpretation of previously printed U labels. Retirement preview must include linked present/issued/returned/pending labeled units. Existing retire can set stock to zero: its same atomic operation must decide active unit disposition; don't leave "present" U labels on a retired/zero stock SKU. Retired code lookup returns "historical retired", not auto-generate/revive inventory. Fresh SKU generation gets fresh SKU-code; historical labels remain in history and, if physically found, require an explicit existing catalog restore/recreate or unresolved-identification workflow. Consolidation must move eligible present unit canonical target with provenance journal and reconcile aggregate stock/reserves; do not rewrite past physical event snapshots or print new labels unless needed. Block when a prior printed label would indicate a different color/size than physical truth.

### I. Reprint / printer outage / bad print

Reprint **same unit** without receipt or stock delta; if a token may be copied/missing, invalidate old token and issue new token. If merely print failed before affixing, retry same print batch/token; do not create new unit per click. A fully unknown physical piece requires identifying it before any barcode is created. No offline stock mutations: if device/network is unavailable, prepare on paper and submit idempotently once connected, without fabricating local confirmations.

## 5. Practical printing

Phase 1 browser/OS-driven: printable label HTML/CSS and downloadable PDF layout. Test thermal label stock around 40×30 mm for short descriptions; use larger format where necessary for long Kazakhstan names, material/length and scanner quiet zone; A4 sticker-sheet layout as fallback. System generates labels server-side from canonical SKU/unit records, preview and batch, then browser print dialogue. A thermal printer installed through OS driver is the simplest model-neutral option. Hardware-direct printing (USB/network vendor protocol or Zebra Browser Print) only after model/OS/driver pilot. Scanner: initial USB HID/keyboard Code 128 reader in a focused barcode input, reject duplicate reads, give sound/visual confirmation; mobile camera/QR possible later if reliable. Barcode or printed token carries opaque ID, not an editable SKU claim. Place detachable label on garment tag/packaging, not adhesive that damages fabric. Confirm exact size and 1D scan readability with actual printer/scanner before production.

## 6. Security, concurrency, migration and cutover

- No blind barcode endpoint accepts arbitrary quantity/source or writes stock directly. Authenticated actor permissions must match operation; role-sensitive print/rebind/void. A barcode scan is never a substitute for authorization.
- One-operation request ID, fingerprint and atomic CAS/db.batch guard per physical mutation; redundant barcode scan/lost HTTP response returns committed result. Conflict must not create a second stock arrival or double-dispatch.
- Add schema without replacing old tables, old endpoints or counts. Introduce feature flags separately for print/scan/read-only and then stock-affecting hooks. DB schema pilot in disposable SQLite/Branch2, not production Main.
- Baseline physical counts remain historical and **are not filled with fictitious serials**. Mark limited subset, measure coverage, migrate by actual handling/new arrivals; never use M labels to rewrite Q physical quantity.
- Cross-run invariants: unit can't be simultaneously available in warehouse and boutique, printed twice as two units, or issued twice; no order receiving money or debt updates from scan; no retry duplicate inventory movements. Historical orders with old shipping markers and newly exchanged lines still work.
- Remove scanner UI with flag if unsafe while keeping existing order/inventory flow; irreversible stock operations must be rolled back ONLY through already proven business corrections, not deleting journal data.

## 7. Proposed phases / acceptance

0. **Design and staff answers:** document actual actor for Kyrgyz arrivals, workshop handoff, dispatch, returned garments and offline/late entries; choose printer/scanner and print template in pilot. Keep unanswered roles/configs explicit.
1. **Additive SKU code / label identity foundation**: migration + indexes + readonly lookup API + admin and warehouse permissions + unit-level audit. No stock writers switched.
2. **Print and barcode read-only:** catalog SKU codes, print labels, scanner matching, same-template reprint and revocation; prove repeated print does not change stock.
3. **Catalog lifecycle compatibility BEFORE stock-affecting rollout:** make retirement/restoration, merge/undo, gender correction, and stale-label handling safe with unit records while old endpoints continue working. Test every existing catalog mutation that remaps or deactivates a variant before allowing an on-hand unit to exist in a live environment.
4. **Arrival + old-stock labeling:** integrated receiving and printed labeling, warehouse source selection, partial batch and printer outage; no duplicate quantities.
5. **Dispatch + workshop:** exact-SKU scan in existing selected dispatch and direct workshop receipt, backward compatible unmarked send; partial and legacy handovers.
6. **Returns/exchanges/stocktake/transfer/writeoff:** integrate into each existing business action and newest Return V2 route and existing legacy fallback, preserve financial ledger and physical freshness.
7. **Branch2 pilot with real scanner and printer**, synthetic D1 and real Worker HTTP; run standard release/business tests and manual UX test of all edge cases, then Main changes only with owner approval and separate controlled release.

**Required tests:** new variant has SKU-code but zero physical; duplicate semantic variant not double-code; 5 arrivals 5 labels stock +5 once; print failure/retry no qty; old stock re-label no qty; two customers same SKU reserve separately; wrong size/source scan rejected; identical double scan/retry rejected; direct workshop shipment without barcode; workshop return into stock; old sent unlabeled item returned; lost label known vs ambiguous; split/partial dispatch, correction/cancel; new/old return flows; stocktake after delayed receipt no double +1; manual correction below labeled coverage does not leave a fictitious present item; retirement with physical labels; restore fresh generation; SKU consolidation/reversion; unauthorized role; unreliable network; performance on 100 labels.

## 8. Decisions not safe to assume yet

- Who receives Kyrgyz arrivals if warehouse supervisor absent and when physical possession starts.
- Who physically receives and dispatches workshop pieces; whether direct shipment occurs without our handler.
- Where physical returned items land before sale, and who can confirm they are in actual stock.
- Printer model, paper/label dimensions, Windows/Mac/Android and USB/network connection; scanner type (1D/2D) and actual test environment.
- Whether every piece is uniquely labeled in phase 1 or only selected high-risk stock; whether warehouse staff can handle labels on workshop-made garments.

**No current production code writes, migrations or releases are part of this draft.**
