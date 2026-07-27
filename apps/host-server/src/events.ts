export type HostEvent = {
  protocolVersion: number
  sequence: number
  channel: string
  args: unknown[]
}

type Listener = (event: HostEvent) => void

export class EventHub {
  private sequence = 0
  private readonly history: HostEvent[] = []
  private readonly listeners = new Set<Listener>()
  private readonly capacity: number

  constructor(capacity = 1024) {
    this.capacity = capacity
  }

  emit(channel: string, args: unknown[]): HostEvent {
    this.sequence += 1
    const event: HostEvent = {
      protocolVersion: 1,
      sequence: this.sequence,
      channel,
      args,
    }
    this.history.push(event)
    while (this.history.length > this.capacity) this.history.shift()
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        /* ignore listener errors */
      }
    }
    return event
  }

  replayAfter(since: number): HostEvent[] {
    return this.history.filter(event => event.sequence > since)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get lastSequence(): number {
    return this.sequence
  }
}
