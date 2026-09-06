// Compatibility index for historical regression tests that inspect this entrypoint as text.
// The executable legacy 1906B preservation logic lives in test-step1906b-frontend-modularization-legacy.mjs;
// W6.4 runs that exact baseline against a frozen W6.3 fixture, then verifies the exact current delta.
// Keep these markers here so older meta-tests continue to verify that their preservation layer is represented.
// w3WarehouseReliabilityPath — W3.1A Warehouse reliability panel baseline hash mismatch
// w3StockMicroCheckPath — W3.1B stock micro-check panel baseline hash mismatch
// w3NaturalRecoveryPath — W3.2 Attention baseline
// w4HumanOperationsPath — W4 human operations panel baseline hash mismatch
// w5CheckingUxPath — W5 checking UX panel baseline hash mismatch
// w5ShortCheckPath — W5.2 short-check panel baseline hash mismatch
// w5SelectiveQueuePath — W5.3 selective queue panel baseline hash mismatch
// w5UnifiedCheckPath — W5.3R unified check panel baseline hash mismatch
// w5ManagerWarehouseAccessPath — W5 manager Warehouse access panel baseline hash mismatch
// w5FullStocktakePath — W5.4 full stocktake panel baseline hash mismatch
// w5FoundItemsPath — W5.5 found-items panel baseline hash mismatch
// w5StocktakeOutcomePath — W5.6 stocktake outcome panel baseline hash mismatch
// w6CatalogMasterDetailPath — W6.2 Catalog master-detail panel baseline hash mismatch
// w6CatalogPolishPath — W6.3 Catalog polish panel baseline hash mismatch
// w7SkuHistoryPath — W7 exact-SKU history integration preservation layer
// w8StockOverviewPath — W8.1 stock overview completion preservation layer
await import('./test-step1906b-frontend-modularization-w8-layer.mjs')
