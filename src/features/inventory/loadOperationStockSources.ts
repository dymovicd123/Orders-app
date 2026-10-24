/**
 * Read-only operation source loader: retries a transient incomplete/stale
 * response, never interprets null, a rejected request, or a partial page as
 * successful stock. A newer operation selection cancels the old UI result.
 */
export type SourceLoadResult<Source extends string> =
  | { status: 'ready'; failedSources: [] }
  | { status: 'cancelled'; failedSources: [] }
  | { status: 'error'; failedSources: Source[] }

export async function loadOperationStockSources<Source extends string>(
  sources: readonly Source[],
  load: (source: Source) => Promise<{ ok?: boolean } | null>,
  current: () => boolean,
  pause: (milliseconds: number) => Promise<void> =
    (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<SourceLoadResult<Source>> {
  let remaining = [...new Set(sources)]
  // Two bounded attempts are enough for the intermittent case where the
  // second user-triggered refresh normally works. Do not poll indefinitely.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!current()) return { status: 'cancelled', failedSources: [] }
    const results = await Promise.allSettled(remaining.map((source) => load(source)))
    if (!current()) return { status: 'cancelled', failedSources: [] }
    remaining = remaining.filter((_, index) => {
      const result = results[index]
      return result.status !== 'fulfilled' || result.value?.ok !== true
    })
    if (!remaining.length) return { status: 'ready', failedSources: [] }
    if (attempt === 0) await pause(350)
  }
  if (!current()) return { status: 'cancelled', failedSources: [] }
  return { status: 'error', failedSources: remaining }
}
