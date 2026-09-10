// Browser-instance only. Shares unfinished reads, never caches completed data.
export function createReadCoalescer() {
  const flights = new Map<string, Promise<Response>>()
  let writes = 0
  return async function run(key: string | null, mutation: boolean, execute: () => Promise<Response>): Promise<Response> {
    if (mutation) {
      writes++
      flights.clear()
      try { return await execute() }
      finally { writes--; flights.clear() }
    }
    if (key === null || writes > 0) return execute()
    let flight = flights.get(key)
    if (!flight) {
      flight = Promise.resolve().then(execute)
      flights.set(key, flight)
    }
    try { return (await flight).clone() }
    finally { if (flights.get(key) === flight) flights.delete(key) }
  }
}
