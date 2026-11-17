// Return V2 is the only editable return flow in Branch2.
// If the Worker flag is lost or the preview fails, stop instead of exposing V1.
export type ReturnV2UiMode = 'checking' | 'v2' | 'error'

export function returnV2PreviewMode(payload: unknown, httpOk: boolean): ReturnV2UiMode {
  if (!httpOk || !payload || typeof payload !== 'object') return 'error'
  const result = payload as { ok?: unknown; enabled?: unknown }
  if (result.ok === false) return 'error'
  if (result.enabled === true) return 'v2'
  return 'error'
}
