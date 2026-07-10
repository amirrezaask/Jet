export type HostRenderer = {
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

const renderers = new Map<string, HostRenderer>()

export function registerHostRenderer(id: string, renderer: HostRenderer): void {
  renderers.set(id, renderer)
}

export function unregisterHostRenderer(id: string): void {
  renderers.delete(id)
}

export function getHostRenderer(id: string): HostRenderer | undefined {
  return renderers.get(id)
}

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  for (const renderer of renderers.values()) {
    if (renderer.isDestroyed()) continue
    renderer.send(channel, ...args)
  }
}

export function sendToClient(clientId: string, channel: string, ...args: unknown[]): void {
  const renderer = renderers.get(clientId)
  if (!renderer || renderer.isDestroyed()) return
  renderer.send(channel, ...args)
}
