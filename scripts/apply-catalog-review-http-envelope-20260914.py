from pathlib import Path
import json
import subprocess


def replace_once(path: str, before: str, after: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(before)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    p.write_text(text.replace(before, after, 1), encoding='utf-8')


def git_blob(path: str) -> str:
    return subprocess.check_output(['git', 'hash-object', path], text=True).strip()


def js_line_count(path: str) -> int:
    text = Path(path).read_text(encoding='utf-8').replace('\r\n', '\n')
    return len(text.split('\n'))


replace_once(
    'src/app/utils.ts',
    "export async function readJsonResponse<T extends object = Record<string, unknown>>(response: Response, context: string): Promise<T> {",
    "export async function readJsonResponse<T extends object = Record<string, unknown>>(response: Response, context: string, options: { allowHttpError?: boolean } = {}): Promise<T> {",
    'readJsonResponse signature',
)
replace_once(
    'src/app/utils.ts',
    "  if (!response.ok) {\n    const message = typeof data === 'object' && data && 'message' in data",
    "  if (!response.ok && !options.allowHttpError) {\n    const message = typeof data === 'object' && data && 'message' in data",
    'readJsonResponse HTTP error guard',
)

app = Path('src/App.tsx')
app_text = app.read_text(encoding='utf-8')
old_shipping = ">(response, 'Отправка клиенту')\n        if (response.ok) completeCriticalRequest"
new_shipping = ">(response, 'Отправка клиенту', { allowHttpError: true })\n        if (response.ok) completeCriticalRequest"
if app_text.count(old_shipping) != 1:
    raise SystemExit(f'shipping reader call: expected exactly 1 match, found {app_text.count(old_shipping)}')
app.write_text(app_text.replace(old_shipping, new_shipping, 1), encoding='utf-8')

contextual_test = Path('scripts/test-contextual-catalog-resolution-r1.mjs')
test_text = contextual_test.read_text(encoding='utf-8')
old_decl = "  const lazySections = read('src/app/lazySections.tsx')\n"
new_decl = old_decl + "  const utils = read('src/app/utils.ts')\n"
if test_text.count(old_decl) != 1:
    raise SystemExit('contextual test declaration guard failed')
test_text = test_text.replace(old_decl, new_decl, 1)
old_check = "  check(app.includes('setOrderCatalogResolutionOrder(order)'), 'Shipping failure must open the resolver instead of redirecting ordinary staff')\n"
new_check = old_check + "  check(utils.includes('allowHttpError?: boolean'), 'Central API reader must support inspecting expected non-2xx business envelopes')\n  check(app.includes(\"'Отправка клиенту', { allowHttpError: true })\"), 'Shipping must inspect catalog_review_required before the generic HTTP error is thrown')\n"
if test_text.count(old_check) != 1:
    raise SystemExit('contextual test assertion guard failed')
contextual_test.write_text(test_text.replace(old_check, new_check, 1), encoding='utf-8')

frontend_gate = Path('scripts/test-step1906b-frontend-modularization.mjs')
gate_text = frontend_gate.read_text(encoding='utf-8')
old_expected = "const contextualCatalogResolutionExpectedFiles = ['src/App.tsx','src/features/orders/OrderCatalogResolutionModal.tsx','src/features/orders/OrderCatalogResolutionModal.css']"
new_expected = "const contextualCatalogResolutionExpectedFiles = ['src/App.tsx','src/app/utils.ts','src/features/orders/OrderCatalogResolutionModal.tsx','src/features/orders/OrderCatalogResolutionModal.css']"
if gate_text.count(old_expected) != 1:
    raise SystemExit('contextual frontend allow-list guard failed')
gate_text = gate_text.replace(old_expected, new_expected, 1)

old_chain = """  if (clientFixesDelta) {
    if (clientFixesDelta.beforeGitBlob !== acceptedGitBlob || clientFixesDelta.beforeLines !== acceptedLines) throw new Error('Client fixes frontend predecessor drifted: ' + file)
    acceptedGitBlob = clientFixesDelta.afterGitBlob
    acceptedLines = clientFixesDelta.afterLines
  }
  if (!delta || gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) throw new Error(clientFixesDelta ? 'Client fixes frontend file changed beyond exact manifest: ' + file : businessDateBoundaryDelta ? 'Business date boundary frontend file changed beyond exact manifest: ' + file : stabilizationDelta ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file : 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)
"""
new_chain = """  if (clientFixesDelta) {
    if (clientFixesDelta.beforeGitBlob !== acceptedGitBlob || clientFixesDelta.beforeLines !== acceptedLines) throw new Error('Client fixes frontend predecessor drifted: ' + file)
    acceptedGitBlob = clientFixesDelta.afterGitBlob
    acceptedLines = clientFixesDelta.afterLines
  }
  const contextualCatalogResolutionDelta = contextualCatalogResolutionManifest.files?.[file]
  if (contextualCatalogResolutionDelta) {
    if (contextualCatalogResolutionDelta.beforeGitBlob !== acceptedGitBlob || contextualCatalogResolutionDelta.beforeLines !== acceptedLines) throw new Error('Contextual catalog resolution frontend predecessor drifted: ' + file)
    acceptedGitBlob = contextualCatalogResolutionDelta.afterGitBlob
    acceptedLines = contextualCatalogResolutionDelta.afterLines
  }
  if (!delta || gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) throw new Error(contextualCatalogResolutionDelta ? 'Contextual catalog resolution frontend file changed beyond exact manifest: ' + file : clientFixesDelta ? 'Client fixes frontend file changed beyond exact manifest: ' + file : businessDateBoundaryDelta ? 'Business date boundary frontend file changed beyond exact manifest: ' + file : stabilizationDelta ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file : 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)
"""
if gate_text.count(old_chain) != 1:
    raise SystemExit('utils exact-manifest chain guard failed')
frontend_gate.write_text(gate_text.replace(old_chain, new_chain, 1), encoding='utf-8')

manifest_path = Path('scripts/contextual-catalog-resolution-r1-frontend-manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
client_manifest = json.loads(Path('scripts/client-fixes-20260912-r1-frontend-manifest.json').read_text(encoding='utf-8'))
utils_predecessor = client_manifest['files']['src/app/utils.ts']
old_files = manifest['files']
manifest['files'] = {
    'src/App.tsx': old_files['src/App.tsx'],
    'src/app/utils.ts': {
        'beforeGitBlob': utils_predecessor['afterGitBlob'],
        'afterGitBlob': git_blob('src/app/utils.ts'),
        'beforeLines': utils_predecessor['afterLines'],
        'afterLines': js_line_count('src/app/utils.ts'),
    },
    'src/features/orders/OrderCatalogResolutionModal.tsx': old_files['src/features/orders/OrderCatalogResolutionModal.tsx'],
    'src/features/orders/OrderCatalogResolutionModal.css': old_files['src/features/orders/OrderCatalogResolutionModal.css'],
}
manifest['files']['src/App.tsx']['afterGitBlob'] = git_blob('src/App.tsx')
manifest['files']['src/App.tsx']['afterLines'] = js_line_count('src/App.tsx')
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
