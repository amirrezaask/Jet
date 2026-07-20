export function createContextMenuHost() {
  let handler: ((x: number, y: number) => void) | null = null

  function register(fn: (x: number, y: number) => void): () => void {
    handler = fn
    return () => {
      if (handler === fn) handler = null
    }
  }

  function showAt(x: number, y: number): void {
    handler?.(x, y)
  }

  return { register, showAt }
}

export function dispatchContextMenuAt(target: HTMLElement, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      view: window,
    }),
  )
}
