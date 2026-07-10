export type HostInvokeContext = {
  clientId: string
}

export type HostInvokeHandler = (
  args: unknown[],
  ctx: HostInvokeContext,
) => unknown | Promise<unknown>

export class HostRegistry {
  private readonly handlers = new Map<string, HostInvokeHandler>()

  handle(channel: string, handler: HostInvokeHandler): void {
    this.handlers.set(channel, handler)
  }

  has(channel: string): boolean {
    return this.handlers.has(channel)
  }

  channels(): string[] {
    return [...this.handlers.keys()]
  }

  async invoke(channel: string, args: unknown[], clientId = "default"): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`unknown host channel: ${channel}`)
    return handler(args, { clientId })
  }
}
