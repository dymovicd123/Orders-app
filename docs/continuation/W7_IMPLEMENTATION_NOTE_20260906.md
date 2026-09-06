# W7 implementation note — history reuse

The implementation intentionally does not create a third history surface. The Catalog exact-SKU card delegates to the existing Warehouse history controller through `openSimpleStockHistory`, preserving its exact source + variant filter and existing movement/check modes. This keeps one history truth and one pagination/read path.
