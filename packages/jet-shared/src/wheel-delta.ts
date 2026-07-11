/**
 * Wheel → CSS-pixel delta for Jet's RAD scroll hijack.
 *
 * Chromium (Electron) pixel deltas map ~1:1 to `scrollTop`.
 * Apple WebKit / WKWebView (Tauri macOS):
 * 1. Must read `deltaMode` **before** `deltaY` — WebKit changes delta units
 *    based on access order (MDN). Reading `deltaY` first then treating
 *    `deltaMode === LINE` multiplies already-pixel values by lineHeight →
 *    runaway scroll.
 * 2. Pixel-mode deltas are denser than Chromium for the same gesture on
 *    retina (`devicePixelRatio` ≥ 2), so divide by DPR.
 */

export function isAppleWebKitEngine(userAgent?: string): boolean {
  const ua =
    userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "")
  return /AppleWebKit/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua)
}

export type WheelDeltaLike = {
  deltaY: number
  deltaMode: number
}

export type WheelDeltaPixelsOptions = {
  /** Override engine detection (tests). */
  webkitEngine?: boolean
  /** Override DPR (tests). Defaults to `window.devicePixelRatio`. */
  devicePixelRatio?: number
  /**
   * Extra gain after DPR normalization on WebKit only.
   * 1 = DPR-only; lower if still too fast after DPR fix.
   */
  webkitGain?: number
}

const DOM_DELTA_PIXEL = 0
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

/** Default extra WebKit gain after dividing by DPR. */
export const APPLE_WEBKIT_WHEEL_GAIN = 1

export function wheelDeltaPixels(
  event: WheelDeltaLike,
  lineHeight: number,
  pageHeight: number,
  opts: WheelDeltaPixelsOptions = {},
): number {
  // WebKit: deltaMode MUST be read before deltaY (unit-switching quirk).
  const deltaMode = event.deltaMode
  const deltaY = event.deltaY
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0

  let pixels: number
  if (deltaMode === DOM_DELTA_LINE) {
    pixels = deltaY * Math.max(1, lineHeight)
  } else if (deltaMode === DOM_DELTA_PAGE) {
    pixels = deltaY * Math.max(1, pageHeight)
  } else {
    // DOM_DELTA_PIXEL (0) or unknown — treat as CSS pixels.
    pixels = deltaY
    const webkit = opts.webkitEngine ?? isAppleWebKitEngine()
    if (webkit && deltaMode === DOM_DELTA_PIXEL) {
      let dpr = opts.devicePixelRatio ?? 1
      if (opts.devicePixelRatio == null && typeof globalThis !== "undefined") {
        const maybe = (globalThis as unknown as { devicePixelRatio?: number }).devicePixelRatio
        if (typeof maybe === "number" && Number.isFinite(maybe) && maybe > 0) dpr = maybe
      }
      const gain = opts.webkitGain ?? APPLE_WEBKIT_WHEEL_GAIN
      pixels = (deltaY / Math.max(1, dpr)) * gain
    }
  }

  if (!Number.isFinite(pixels) || pixels === 0) return 0
  // One event should not jump more than a viewport — guards WebKit spikes.
  const cap = Math.max(1, pageHeight)
  if (Math.abs(pixels) > cap) {
    pixels = Math.sign(pixels) * cap
  }
  return pixels
}
