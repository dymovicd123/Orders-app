from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = "246dfea9fb999fd10b68ad2b4a6d716f2d3792a8"
INVENTORY_REL = "src/features/sections/InventorySection.tsx"
PANEL_REL = "src/features/inventory/views/renderInventoryCatalogPanel.tsx"
COMPONENT_REL = "src/features/inventory/views/catalogPolishExecutionGroups.tsx"
FIXTURE_REL = "scripts/fixtures/InventorySection-w6-4-baseline.tsx"
LAYER_REL = "scripts/test-step1906b-frontend-modularization-w7-layer.mjs"
MANIFEST_REL = "scripts/w7-sku-history-frontend-manifest.json"


def blob_sha(text: str) -> str:
    body = text.encode("utf-8")
    return hashlib.sha1(f"blob {len(body)}\0".encode("utf-8") + body).hexdigest()


def replace_once(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f"expected exactly one occurrence for replacement: {old[:100]!r}; found {text.count(old)}")
    return text.replace(old, new, 1)


subprocess.run(["git", "fetch", "origin", BASE_SHA, "--depth=1"], cwd=ROOT, check=True)
baseline_inventory = subprocess.check_output(
    ["git", "show", f"{BASE_SHA}:{INVENTORY_REL}"], cwd=ROOT
).decode("utf-8")
current_inventory = (ROOT / INVENTORY_REL).read_text(encoding="utf-8")

if "const historyRequestRef = useRef(0)" in baseline_inventory:
    raise RuntimeError("W6.4 baseline unexpectedly already contains W7 history request token")
if "const historyRequestRef = useRef(0)" not in current_inventory:
    raise RuntimeError("current W7 InventorySection is missing history request token")
if "openSimpleStockHistory,\n        openOrderFromFinance," not in current_inventory:
    raise RuntimeError("current W7 InventorySection is missing Catalog history opener wiring")

fixture_path = ROOT / FIXTURE_REL
fixture_path.parent.mkdir(parents=True, exist_ok=True)
fixture_path.write_text(baseline_inventory, encoding="utf-8")

manifest_path = ROOT / MANIFEST_REL
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
if manifest.get("version") != 1 or manifest.get("revision") != "w7-sku-history-price-readiness":
    raise RuntimeError("unexpected W7 manifest header")
files = manifest.get("files", {})
expected_existing = [PANEL_REL, COMPONENT_REL]
if list(files.keys()) != expected_existing:
    raise RuntimeError(f"unexpected W7 manifest before preservation expansion: {list(files.keys())}")
files[INVENTORY_REL] = {
    "beforeGitBlob": blob_sha(baseline_inventory),
    "afterGitBlob": blob_sha(current_inventory),
}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

layer_path = ROOT / LAYER_REL
layer = layer_path.read_text(encoding="utf-8")
layer = replace_once(
    layer,
    "const baselineComponentPath = path.join(root, 'scripts/fixtures/catalogPolishExecutionGroups-w6-4-baseline.tsx')\n",
    "const baselineComponentPath = path.join(root, 'scripts/fixtures/catalogPolishExecutionGroups-w6-4-baseline.tsx')\nconst baselineInventoryPath = path.join(root, 'scripts/fixtures/InventorySection-w6-4-baseline.tsx')\n",
)
layer = replace_once(
    layer,
    "for (const required of [panelPath, componentPath, inventoryPath, baselinePanelPath, baselineComponentPath, w6LayerPath, w6ManifestPath, manifestPath])",
    "for (const required of [panelPath, componentPath, inventoryPath, baselinePanelPath, baselineComponentPath, baselineInventoryPath, w6LayerPath, w6ManifestPath, manifestPath])",
)
layer = replace_once(
    layer,
    "  const componentRel = 'src/features/inventory/views/catalogPolishExecutionGroups.tsx'\n  const expectedFiles = [panelRel, componentRel]",
    "  const componentRel = 'src/features/inventory/views/catalogPolishExecutionGroups.tsx'\n  const inventoryRel = 'src/features/sections/InventorySection.tsx'\n  const expectedFiles = [panelRel, componentRel, inventoryRel]",
)
layer = replace_once(
    layer,
    "  const baselineComponent = fs.readFileSync(baselineComponentPath, 'utf8')\n",
    "  const baselineComponent = fs.readFileSync(baselineComponentPath, 'utf8')\n  const baselineInventory = fs.readFileSync(baselineInventoryPath, 'utf8')\n",
)
layer = replace_once(
    layer,
    "  check(manifest.files[componentRel].beforeGitBlob === w6Manifest.files[componentRel].afterGitBlob, 'W7 component before hash does not chain from W6.4')\n  check(gitBlobSha(currentPanel) === manifest.files[panelRel].afterGitBlob, 'W7 catalog panel changed beyond exact manifest')",
    "  check(manifest.files[componentRel].beforeGitBlob === w6Manifest.files[componentRel].afterGitBlob, 'W7 component before hash does not chain from W6.4')\n  check(gitBlobSha(baselineInventory) === manifest.files[inventoryRel].beforeGitBlob, 'W7 frozen InventorySection is not the exact pre-W7 baseline')\n  check(gitBlobSha(currentInventory) === manifest.files[inventoryRel].afterGitBlob, 'W7 InventorySection changed beyond exact manifest')\n  check(gitBlobSha(currentPanel) === manifest.files[panelRel].afterGitBlob, 'W7 catalog panel changed beyond exact manifest')",
)
layer = replace_once(
    layer,
    "  check(currentInventory.includes('openSimpleStockHistory,\\n        openOrderFromFinance,'), 'W7 InventorySection does not pass its existing exact-history opener to Catalog')\n",
    "  check(currentInventory.includes('openSimpleStockHistory,\\n        openOrderFromFinance,'), 'W7 InventorySection does not pass its existing exact-history opener to Catalog')\n  check(currentInventory.includes('const historyRequestRef = useRef(0)') && currentInventory.includes('const requestId = ++historyRequestRef.current'), 'W7 InventorySection lost history request generation')\n  check(currentInventory.includes('if (requestId !== historyRequestRef.current) return') && currentInventory.includes('if (requestId === historyRequestRef.current) setHistoryBusy(false)'), 'W7 stale history response guard is incomplete')\n",
)
layer = replace_once(
    layer,
    "  fs.writeFileSync(panelPath, baselinePanel)\n  fs.writeFileSync(componentPath, baselineComponent)\n",
    "  fs.writeFileSync(panelPath, baselinePanel)\n  fs.writeFileSync(componentPath, baselineComponent)\n  fs.writeFileSync(inventoryPath, baselineInventory)\n",
)
layer = replace_once(
    layer,
    "    fs.writeFileSync(panelPath, currentPanel)\n    fs.writeFileSync(componentPath, currentComponent)\n",
    "    fs.writeFileSync(panelPath, currentPanel)\n    fs.writeFileSync(componentPath, currentComponent)\n    fs.writeFileSync(inventoryPath, currentInventory)\n",
)
layer = replace_once(
    layer,
    "  check(fs.readFileSync(panelPath, 'utf8') === currentPanel && fs.readFileSync(componentPath, 'utf8') === currentComponent, 'W7 frontend structural gate failed to restore current catalog files')",
    "  check(fs.readFileSync(panelPath, 'utf8') === currentPanel && fs.readFileSync(componentPath, 'utf8') === currentComponent && fs.readFileSync(inventoryPath, 'utf8') === currentInventory, 'W7 frontend structural gate failed to restore current W7 files')",
)
layer = replace_once(
    layer,
    "W7 FRONTEND STRUCTURAL LAYER PASSED — W6.4 baseline preserved; exact source-specific SKU history integration accepted",
    "W7 FRONTEND STRUCTURAL LAYER PASSED — W6.4 baseline preserved; exact Catalog + InventorySection history/race delta accepted",
)
layer_path.write_text(layer, encoding="utf-8")

print("W7 inventory preservation applied")
print("baseline InventorySection blob:", blob_sha(baseline_inventory))
print("current InventorySection blob:", blob_sha(current_inventory))
