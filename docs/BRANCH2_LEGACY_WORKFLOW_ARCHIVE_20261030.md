# Branch2 legacy Cloudflare / D1 automated jobs — archived 2026-10-30

Seventy-five previously automatic Branch2 workflows had privileged Cloudflare access or a direct deploy path. Historical one-off jobs were still active after the modern native Branch2 build trigger was switched to version upload only.

After P0 merge to branch2 on 2026-10-30, the historical workflow `branch2-pending-exchange-initial-shipping-20261028.yml` ran `npx wrangler deploy`, creating active deployment `a400a419-de33-4880-ad58-7c93634ce4b0` with version `2781a20c-e430-4bbd-bfd2-47c500056a00` at 16:50:20 UTC. The underlying deployed app was built from the same merged P0 source tree. This bypassed the new upload-only trigger. Historical job log: [GitHub Actions 41093332529](https://github.com/dymovicd123/Orders-app/actions/runs/41093332529).

This security housekeeping **does not alter application code, Cloudflare triggers, D1 schema or data, or active deployments**. It replaces each obsolete workflow with a deliberately inert manual stub and preserves the original file at source commit `459cfe0fdb552e20dc76392265067dd82688b655`, recoverable with `git show 459cfe0fdb552e20dc76392265067dd82688b655:.github/workflows/<filename>`. The former tests and scripts remain in the repository. Current `Quality check` and the semantic Branch2 release gate are not archived.

An exact regression checks 75 inert files. Any future release must use a separate explicit, pinned Worker version promotion. Database-changing one-off tasks must likewise be separately approved and gated. Do not blindly reactivate old workflows.

## Original archived workflows

- `auth-hardening-branch2-migration-0081.yml`
- `auth-login-branch2-migration-0080.yml`
- `branch2-admin-delete-correction-schema-0110-0111.yml`
- `branch2-catalog-atomic-finalization-schema-0096.yml`
- `branch2-catalog-integrity-schema-0090-0092.yml`
- `branch2-catalog-merge-generation-schema-0099.yml`
- `branch2-catalog-only-operations-20261027.yml`
- `branch2-catalog-stock-reconciliation-schema-0095.yml`
- `branch2-city-team-warehouse-20261025.yml`
- `branch2-consolidated-sku-order-guard-0097.yml`
- `branch2-consolidated-sku-stock-guard-0098.yml`
- `branch2-counted-sku-undo-schema-0103.yml`
- `branch2-create-mirror-d1-20261027.yml`
- `branch2-d1-small-import-probe-20261027.yml`
- `branch2-ethno-manual-finalization-schema-0109.yml`
- `branch2-event8-readonly-diagnostic-20261018.yml`
- `branch2-exchange-delayed-dispatch-20261028.yml`
- `branch2-exchange-pending-resolver-guard-20261028.yml`
- `branch2-kpi-diagnostic-20261027.yml`
- `branch2-main-catalog-sync-once.yml`
- `branch2-main-data-clone-20261027.yml`
- `branch2-manager-finance-20261024.yml`
- `branch2-mirror-local-readonly-dryrun-20261027.yml`
- `branch2-partial-return-atomic-exchange-ui-20261028.yml`
- `branch2-pending-exchange-initial-shipping-20261028.yml`
- `branch2-positive-stock-sku-undo-schema-0102.yml`
- `branch2-product-kpi-20261026.yml`
- `branch2-reference-merge-schema-0093-0094.yml`
- `branch2-reference-reason-schema-0105.yml`
- `branch2-reserved-sku-undo-schema-0104.yml`
- `branch2-retired-item-issue-0113.yml`
- `branch2-retired-one-line-correction-0114.yml`
- `branch2-return-hint-cleanup-20261028.yml`
- `branch2-stage05-selective-deploy.yml`
- `branch2-verified-mirror-cutover-20261027.yml`
- `branch2-zero-stock-sku-remerge-schema-0101.yml`
- `branch2-zero-stock-sku-undo-schema-0100.yml`
- `catalog-granular-history-branch2-migration-0079.yml`
- `catalog-restore-resumability-branch2-migration-0078.yml`
- `catalog-retirement-branch2-repair-20260929.yml`
- `catalog-safe-restore-branch2-migration-0077.yml`
- `catalog-safe-retirement-branch2-migration-0076.yml`
- `kaspi-order-separation-branch2-migration-0082.yml`
- `read-only-bayan-production-inventory-20261013.yml`
- `read-only-kebek-inventory-20261013.yml`
- `return-attributes-release-20261029.yml`
- `return-kind-physical-receipt-acceptance-20261028.yml`
- `stage03-branch2-migration-0072.yml`
- `stage03-branch2-migration-0073.yml`
- `stage03-branch2-migration-0074.yml`
- `stage03-h7-branch2-safety-baseline.yml`
- `stage04-branch2-enable-test-capture.yml`
- `stage04-branch2-migration-0075.yml`
- `stage04-branch2-migration-0083.yml`
- `stage04-branch2-migration-0084.yml`
- `stage04-branch2-migration-0106.yml`
- `stage04-branch2-migration-0107.yml`
- `stage04-branch2-migration-0108.yml`
- `stage04-branch2-unpriced-diagnostic.yml`
- `w10-branch2-stock-label-release.yml`
- `w11-branch2-audit-release.yml`
- `w12-01-operation-colors-deploy.yml`
- `w12-02-stock-overview-release.yml`
- `w12-03-sku-history.yml`
- `w12-04-stock-issues.yml`
- `w13-stock-catalog-release.yml`
- `w14-simple-stock-controls.yml`
- `w15-stock-readability-load.yml`
- `w16-stock-attention-actions.yml`
- `w17-optional-stock-notes-clear.yml`
- `w18-variant-history-investigation.yml`
- `w6-branch2-selective-deploy.yml`
- `w7-stocktake-operations-branch2.yml`
- `w8-branch2-selective-release.yml`
- `w9-branch2-selective-release.yml`
