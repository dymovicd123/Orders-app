# Stage03-H8 — Existing itemized order editing

Date: 2026-09-25

Status: **H8A backend foundation + H8B restricted editor UI implemented on Branch2.**

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

The itemized PATCH contains only the H8A allow-listed metadata plus `paymentCorrections`. It does not contain `items`, replacement `payments`, `orderTotal`, `sourceType`, lifecycle or shipping fields.

A separate future step is required for any real commercial/physical edit of an itemized order, including sold-price correction, SKU/quantity/source changes or itemized exchange semantics.

Environment rule remains unchanged: Branch2 Worker + Branch2 D1 only. Production is not a target.
