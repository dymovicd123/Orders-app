# W5 manager Warehouse access hotfix — 2026-09-05

## Why
The W5.3R unified Check screen exposed manager-visible actions, but stale controller guards still returned immediately for non-admin users. The same stale pattern also prevented managers from loading active checks and the primary Warehouse History screen.

## Fixed
- Managers can start selective and full stocktakes.
- Managers can discover and resume active stocktake sessions.
- Stocktake reference dictionaries are read for managers so existing known characteristics can be used during a check.
- Managers can load Warehouse movement history and check/stocktake history.
- `Открыть проверку` from the short-check conflict state is available to managers.
- Exact SKU `История позиции` is available to managers as read-only history.

## Deliberately still admin-only
- Catalog/master-data management and creation of new reference values.
- Structural product identity recovery that requires catalog decisions.
- Service/diagnostics.
- Destructive reversal of an inventory movement.

## Safety
No migration, no D1 diagnostic/read/write, no Branch2 change. Arrival visual workspace stays frozen. Backend stocktake and history routes were already manager-safe; this patch removes stale frontend-only role mismatches and preserves server authority for admin-only master-data creation.
