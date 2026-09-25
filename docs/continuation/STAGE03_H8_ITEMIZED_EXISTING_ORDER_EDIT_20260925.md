# Stage03-H8 — Existing itemized order editing

Date: 2026-09-25

Status: **H8A–H8E safety foundations implemented; H8F consolidates them into one direct itemized editor on Branch2.**

## Why H8 exists

H7 intentionally activated itemized pricing only for new order creation. The old full-order editor remained blocked for `itemized_v1` because it was built around a manually editable order total and could rewrite item rows/inventory.

That guard remains correct for commercial or physical rewrites, but it is unnecessarily broad for safe non-commercial corrections such as:
- order date;
- manager;
- customer identity;
- city;
- delivery text;
- comment;
- correction of already-posted payment facts through the existing audited payment-correction path.

## H8A — backend metadata-only lane

`updateOrderCritical` now recognizes an itemized metadata-only edit only when the request contains **none** of the following:
- external order ID;
- items;
- payments replacement;
- order total;
- pricing mode;
- source type;
- Workshop lifecycle status;
- order lifecycle status;
- shipping status/date.

If any of those are present, the existing itemized fail-closed guard still rejects the legacy PATCH.

The allowed lane therefore cannot:
- reprice a sold item;
- change `catalog_price_snapshot`;
- change quantity/product/SKU/source;
- move stock or reservations;
- replace the payment ledger;
- alter order/workshop/shipping lifecycle.

The persisted itemized `orders.total_amount` remains unchanged. Existing posted-payment corrections may update received/debt through the already-audited correction path.

## H8B — restricted editor UI

The ordinary Edit action may now open an `itemized_v1` order when its operational projection allows editing, but the form switches into a restricted mode:

- order date, manager, customer name/phone, city, delivery text and comment remain editable;
- order total is shown as historical read-only data;
- order lifecycle status is shown read-only and still changes only through dedicated actions;
- product identity, quantity, source, Workshop item fields and stock availability actions are disabled;
- final sold price, historical Catalog recommendation and line total are visible for each item;
- product add/remove is unavailable;
- new payments are not staged in this editor;
- existing posted payments can use the existing audited correction path;
- exchange-linked extra payment keeps its previous restriction: only payment method is editable here;
- after an itemized metadata/payment correction, Inventory caches are not invalidated because no stock fact changed.

The itemized PATCH contains only the H8A allow-listed metadata plus `paymentCorrections`. It does not contain the external order ID, `items`, replacement `payments`, `orderTotal`, `sourceType`, lifecycle or shipping fields.

## H8C — dedicated sold-price correction

The restricted itemized editor now has one explicit commercial correction: the already-sold unit price of an existing line may be corrected without sending the full item array.

Safety rules:

- correction targets the persisted `order_items.id`, never list position alone;
- the client sends the previously observed unit price, quantity, line total and Catalog snapshot;
- the server re-reads the active order-item rows and rejects stale or duplicate corrections;
- the new unit price must be a safe integer from 0;
- `line_total`, `orders.total_amount` and `orders.debt_amount` are derived again on the server;
- a correction that would make recorded payments exceed the corrected order total is rejected;
- current `catalog_price_snapshot` is checked for staleness but never changed;
- product/SKU, quantity, source, Workshop fields, reservations and physical stock are not rewritten;
- active Return/Exchange operations still block the correction;
- the UI requires an explicit price confirmation after a value is changed.

This does not enable SKU, quantity or source changes in the UI and does not define itemized exchange pricing.

## H8D — stale-safe itemized composition rewrite foundation

The backend now has a dedicated `itemContentReplacement` primitive for a future restricted composition editor. H8D does **not** expose this action in the UI yet.

The replacement request is deliberately separate from the legacy `items` field and from H8C price correction. It carries:
- a complete expected snapshot of the currently active order lines, keyed by persisted `order_items.id`;
- a complete proposed replacement composition with explicit source, final sold price and explicit Catalog snapshot/null.

Before any physical rewrite the server:
- rejects malformed replacement envelopes and empty replacement sets;
- rejects use on legacy orders or together with delete, metadata edits, posted-payment corrections, H8C price corrections or the legacy full `items` field;
- verifies every expected active line still exists and still matches identity, quantity, sold price, line total and historical Catalog snapshot;
- rejects duplicate/missing old line identities;
- requires every proposed line to explicitly name Warehouse/Boutique/Workshop and explicitly carry `catalogPriceSnapshot` or null;
- preserves the old Catalog snapshot when the confirmed price key (product + adult/child + material + length) is unchanged;
- requires a real physical/content change; price-only corrections stay in H8C;
- blocks sent orders, partial fulfilled handovers and orders with active Return/Exchange operations before catalog/reservation rewrite;
- revalidates proposed stock availability while excluding this order's old reservations;
- rebuilds itemized totals against existing payments and rejects overpayment;
- derives the coarse order source from the first non-Workshop proposed line.

When committed, the existing safe rewrite machinery releases/reverses old reservations, retires old active rows without deleting history, cancels replaced Workshop tasks, inserts new itemized rows with their historical Catalog snapshots, recreates Workshop tasks/reservations, and preserves inventory-obligation lineage for unchanged physical identities where possible.

## H8E — dedicated composition editor

The itemized editor now exposes composition changes only through an explicit **«Изменить состав»** mode. Normal H8B metadata/payment correction and H8C price-only correction remain separate actions.

When H8E starts, the client refreshes current Catalog prices and both Warehouse/Boutique stock snapshots, then resets the form to the persisted order truth. In composition mode:

- order metadata and payments are disabled and are not sent in the PATCH;
- physical item fields become editable and item add/remove is enabled;
- removing the final remaining line is blocked;
- the H8C price-only panel is hidden so price-only correction cannot be mixed with a physical rewrite;
- product + adult/child + material + length changes are re-resolved against the current Catalog price;
- a historical manual sold-price override is preserved only with an explicit re-confirmation after such a price-key change;
- if Catalog has no current price, the final sold price must be entered manually;
- Catalog snapshot/null is always explicit in the replacement request;
- future availability is previewed with the current order's matching reservation treated as releasable, so the preview models replacement rather than double-reserving the old and new composition;
- the manager can still choose «Посчитать сейчас» or «Сейчас проверить не могу» for a shortage; the server performs the authoritative fresh stock check before writing.

The client sends only the dedicated `itemContentReplacement` envelope. It includes the complete expected old-line snapshot and the complete proposed new composition. Order metadata, payment corrections, H8C price corrections, lifecycle and shipping fields are absent from that request.

The server remains authoritative: it repeats all H8D stale checks, stock checks, payment/total validation and reservation/Workshop rewrite logic. A successful H8E save invalidates inventory caches because physical obligations changed.

Itemized exchange pricing is still intentionally separate and remains disabled.

Environment rule remains unchanged: Branch2 Worker + Branch2 D1 only. Production is not a target.


## Branch2 deploy fallback

Cloudflare Workers Builds may occasionally report a Branch2 build as `skipped` without running the project build. The deploy monitor now has a Branch2-only fallback for that exact outcome.

Before the fallback deploys it verifies the exact checked-out commit, `orders-app-branch2`, `orders_db_branch2` and the Branch2 D1 id, explicitly rejects Production D1 identifiers, runs the full release check, and only then executes the normal deploy command.

The fallback never runs for `main`, does not run migrations, and does not execute D1 commands.


## H8F — direct editor UX

Manual acceptance exposed an important UX problem in the staged H8 rollout: the technical safety lanes had become visible as permission-like UI modes. The separate «Изменить состав» button and per-price confirmation clicks are not business requirements and are removed.

For an authorized editable itemized order, opening **Редактировать** now means the form is immediately editable:
- order metadata, item composition, quantity, source, Workshop fields and sold price are editable in the same screen;
- changing sold price does not require a second confirmation click;
- changing a Catalog price-driving dimension re-resolves the current Catalog recommendation; a deliberately manual sold price remains manual without an extra acknowledgement;
- existing posted payments are visibly editable in-place, including amount/date/method/kind/comment where their financial origin permits it;
- new primary/debt-close payment drafts can be added from the same payment panel;
- itemized total, edited received amount and debt preview update in the editor.

The client still chooses the narrowest safe server contract on Save:
- if physical composition did not change, sold-price-only changes use H8C;
- if physical composition changed, H8D replacement is used;
- metadata and posted-payment corrections may now accompany H8D replacement in the same critical operation;
- H8D replacement never carries a duplicate H8C `itemPriceCorrections` payload.

The server remains authoritative. Stale row/payment snapshots, sent/downstream-operation guards, stock re-check, Catalog snapshot rules and overpayment protection remain unchanged. For a combined composition + posted-payment correction, received/debt are derived from the corrected payment amount and the rewritten itemized total before commit.

Lifecycle actions (send/delete/return/exchange) remain separate because they represent distinct business operations, not ordinary field editing.


## H8G — direct sold-price UX in Create

Manual acceptance also rejected the remaining per-line «confirm price» step in new-order Create. The technical confirmation flag is no longer a save blocker and no confirmation button is shown.

When a manager has deliberately typed a sold price and then changes a Catalog-driving characteristic (product / adult-child / material / length):
- the current Catalog recommendation/snapshot is re-resolved;
- the manager-entered sold price remains the final sold price;
- Save does not require another acknowledgement click;
- missing price, invalid price, invalid quantity, invalid payment and overpayment still fail closed.

This chooses the least destructive mobile behavior: never silently erase a manager-entered sold price and never confuse it with the mutable Catalog recommendation.
