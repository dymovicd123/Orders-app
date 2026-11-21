/**
 * Camera-only frame gate. Each accepted Code128 is one physical presentation.
 * Failed decode frames alone are not evidence that a label was removed:
 * the same code needs both sustained absence and several missed frames.
 * HID/manual scans bypass this gate and each have their own request ID.
 */
export class StocktakeCameraScanGate {
  private lastCode = ''
  private missingSince: number | null = null
  private missingFrames = 0
  private lastMissAt: number | null = null
  private readonly releaseMs: number
  private readonly requiredMisses: number
  constructor(releaseMs = 1900, requiredMisses = 8) {
    this.releaseMs = releaseMs
    this.requiredMisses = requiredMisses
  }

  detected(code: string, now: number): boolean {
    if (!code || !Number.isFinite(now)) return false
    const different = code !== this.lastCode
    const rePresented = this.missingSince !== null
      && now - this.missingSince >= this.releaseMs
      && this.missingFrames >= this.requiredMisses
    // Any successfully decoded label cancels the absent-frame streak.
    this.missingSince = null
    this.missingFrames = 0
    this.lastMissAt = null
    if (!different && !rePresented) return false
    this.lastCode = code
    return true
  }

  missing(now: number): void {
    if (!this.lastCode || !Number.isFinite(now)) return
    if (this.lastMissAt !== null && now <= this.lastMissAt) return
    if (this.missingSince === null) this.missingSince = now
    this.lastMissAt = now
    this.missingFrames++
  }

  // Explicit operator acknowledgment for a second physical item of the same
  // shared SKU. Never required when a different code is seen.
  nextPhysicalItem(): void {
    this.lastCode = ''
    this.missingSince = null
    this.missingFrames = 0
    this.lastMissAt = null
  }

  reset(): void {
    this.nextPhysicalItem()
  }
}
