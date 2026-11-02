#!/usr/bin/env bash
set -euo pipefail
test "$(git branch --show-current)" = "candidate/main-stage345-port-20261102"
test "$(git rev-parse 68eb304be61483145345ba0a9259a05398b9aecb^{commit})"
git fetch origin +refs/heads/branch2:refs/remotes/origin/branch2 +refs/pull/752/head:refs/remotes/origin/stage5-old
base=8814a85751e18d2e0c305db35cbc8e943b036384
old=origin/stage5-old
paths=(
  migrations/0119_v72_order_dispatch_lineage.sql
  scripts/test-catalog-resolver-r10-acceptance-matrix.mjs
  scripts/test-stage5b-dispatch-atomic-d1-20261101.mjs
  scripts/test-stage5b-http-routes-20261101.mjs
  src/App.tsx
  src/app/orderShipmentProjection.ts
  src/features/sections/OrderShipmentStatus.css
  src/features/sections/OrdersTableSection.tsx
  worker/domains/order-dispatch-cancel.ts
  worker/domains/order-dispatch.ts
  worker/domains/order-shipment-plan.ts
  worker/domains/orders-read.ts
  worker/domains/orders-relations.ts
  worker/domains/orders-write.ts
  worker/index.ts
)
echo "BASELINE_MAIN=$(git rev-parse HEAD)"
echo "PR752_BASE=$base"
echo "PR752_HEAD=$(git rev-parse "$old")"
git diff --binary "$base" "$old" -- "${paths[@]}" > /tmp/main-stage5-previous.patch
if ! git apply --3way --index /tmp/main-stage5-previous.patch; then
  echo "MAIN_752_THREEWAY_CONFLICT" >&2
  git status --short >&2
  git diff --name-only --diff-filter=U >&2
  exit 30
fi
echo 'PR752_THREE_WAY_APPLY_PASS'
# Keep latest Main regression checklist; add accepted Stage5 cases without
# restoring older Main PR752 snapshot of the gate.
python3 - <<'PY'
from pathlib import Path
p=Path('scripts/test-main-current-business-release-20261031.mjs')
s=p.read_text()
needle=" 'scripts/test-old-order-post-stocktake-handover-r1.mjs',"
assert s.count(needle)==1
cases=[
 "scripts/test-stage5-client-quantity-replay-20261102.mjs",
 "scripts/test-stage5b-dispatch-atomic-d1-20261101.mjs",
 "scripts/test-stage5b-http-routes-20261101.mjs",
]
s=s.replace(needle, "".join(" '"+case+"',\n" for case in cases)+needle)
p.write_text(s)
PY
# PR752 was an intentionally older candidate. Bring NEW Stage5-only modules
# to the currently accepted Branch2 version, without overwriting Main
# stage1/2 worker, stock, resolver or existing order-write integration.
for path in \
  worker/domains/order-dispatch.ts \
  worker/domains/order-dispatch-cancel.ts \
  worker/domains/order-shipment-plan.ts \
  src/app/orderShipmentProjection.ts \
  src/features/sections/OrderShipmentStatus.css \
  src/features/orders/shippingSelection.ts \
  scripts/test-stage5b-dispatch-atomic-d1-20261101.mjs \
  scripts/test-stage5b-http-routes-20261101.mjs \
  scripts/test-stage5-client-quantity-replay-20261102.mjs
do
  mkdir -p "$(dirname "$path")"
  git show "origin/branch2:$path" > "$path"
done
git add -A
echo 'MAIN_STAGE5_SELECTIVE_CANDIDATE_FILES'
git diff --cached --stat
git diff --cached --name-only | grep -E '^wrangler\.jsonc$|^package-lock\.json$|^migrations/00[0-9][0-9]' && { echo 'UNEXPECTED_DEPLOY_OR_MIGRATION_SCOPE'; exit 32; } || true
echo 'MAIN_STAGE5_SOURCE_PREPARED'
