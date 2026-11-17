/**
 * Frame-level gate, not an SKU de-duplication rule:
 * the same SKU can represent many identical pieces. It becomes countable again
 * only after the barcode disappears from the camera for a sustained interval.
 * USB trigger events are independent and never pass through this gate.
 */
export class StocktakeCameraScanGate {
  private lastCode = ''
  private missingSince: number | null = null
  constructor(private readonly releaseMs = 650) {}

  detected(code: string, now: number): boolean {
    if (!code || !Number.isFinite(now)) return false
    const fresh = code !== this.lastCode ||
      (this.missingSince !== null && now - this.missingSince >= this.releaseMs)
    this.lastCode = code
    this.missingSince = null
    return fresh
  }

  missing(now: number): void {
    if (this.lastCode && this.missingSince === null && Number.isFinite(now)) {
      this.missingSince = now
    }
  }

  reset(): void {
    this.lastCode = ''
    this.missingSince = null
  }
}
