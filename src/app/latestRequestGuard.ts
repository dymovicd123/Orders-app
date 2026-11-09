/** Ensures an older async read cannot publish after a newer read has started. */
export function createLatestRequestGuard() {
  let latest = 0
  return {
    begin: () => ++latest,
    isCurrent: (requestId: number) => requestId === latest,
  }
}
