import { lazy, Suspense } from "react"

const OverlayHostContent = lazy(() => import("./OverlayHostContent.js"))

/**
 * Keep command palettes, settings, and list virtualization out of the cold
 * startup graph. App only mounts this host when an overlay opens.
 */
export default function OverlayHost() {
  return (
    <Suspense fallback={null}>
      <OverlayHostContent />
    </Suspense>
  )
}
