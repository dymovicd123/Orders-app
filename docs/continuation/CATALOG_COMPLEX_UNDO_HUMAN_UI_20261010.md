# Complex catalog merge undo — admin UX handoff (2026-10-10)

## Delivered UI
The **Справочники → Дополнительные действия → Разобрать прежнее объединение товаров** accordion hosts the human-language, **admin-only** `CatalogUndoCases` view. It is lazily mounted only when explicitly opened, so daily reference CRUD and staff order/warehouse operations are not slowed down by extra reads. It uses existing login-aware `apiFetch` rather than bypassing the application authentication/session layer.

The administrator can:
1. Pick any of the last 30 consolidated SKU roots by product + source/keeper color/date. For older items, a collapsed **Нужного объединения нет в списке?** field accepts an original numeric merge reference; it is not prominent in the daily view.
2. Click **Проверить объединение**; load read-only `consolidation-undo-case-review` and `consolidation-undo-case-workplan` together. Display original reservation count, later orders, warehouse movements and stocktakes; highlight incomplete evidence.
3. Compare CURRENT physical stock and reserved quantity independently for warehouse and boutique, without offering the old merged quantities as an automatic source of truth.
4. Read a prioritized business-language task list: preserve shipped/returned order history; solve active customer commitments using normal operational workflows; count current physical items as needed; recover missing audit evidence.
5. Follow ordinary `#orders` and `#inventory` app navigation links to act in normal order/return/exchange and inventory/stocktake pages rather than receiving a new secret compensating writer.
6. Inspect all source-reservation, subsequent-order, inventory movement and stocktake records with 20-entry bounded cursor pages; **Показать ещё 20** for the tail of long cases. Page requests ignore stale responses when selecting a different root or tab.
7. Recheck all facts after intervening live operations using **Обновить данные**.

The page deliberately NEVER calls undo-write APIs, never instructs blind direct database editing, and never asserts that reading all pages authorizes a physical or financial rollback. Order snapshots, payment records, shipped orders and inventory movements remain immutable. No long-lived locks, background tasks, or separate databases.

## Testing and exact deployment
- Stage04-safe manifest pins `ReferencesSection.tsx`, new view, new CSS and UI safety test.
- New regression checks admin-only lazy entry, responsive layout, all four paginated section links, stale-request suppression, ordinary app navigation and absence of POST/undo calls.
- Existing cumulative integration, frontend TypeScript/build, Quality and Cloudflare checks must pass before merge into `branch2`; verify exact `branch2` build + public frontend. Leave `main` and its production D1 untouched.

## Remaining global catalog work
Characteristic merges across distinct underlying SKU attributes; duplicate creation guards; writeoff UX modernization; end-to-end business and access audit including admin resolution journey; explicit separate approval before main/production. If business later needs a genuine corrective stock transfer after a shipped/returned case, design it as a new explicitly authorized physical action backed by current count/reservation evidence and append-only ledger — never a history rewrite.
