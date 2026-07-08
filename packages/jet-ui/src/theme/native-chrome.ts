/** Resolve themed CSS variables to computed rgb/rgba for Electron native chrome. */
export function readThemedNativeChrome(): { background: string; foreground: string } {
  const root = document.documentElement
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:fixed;left:-9999px;top:-9999px;background:var(--background);color:var(--foreground)"
  root.appendChild(probe)
  const styles = getComputedStyle(probe)
  const background = styles.backgroundColor
  const foreground = styles.color
  probe.remove()
  return { background, foreground }
}

export function syncNativeChromeFromTheme(): void {
  if (typeof window === "undefined" || !window.jet?.syncNativeChrome) return
  const colors = readThemedNativeChrome()
  void window.jet.syncNativeChrome(colors)
}
