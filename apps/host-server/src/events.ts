export type HostEvent = {
  protocolVersion: number
  sequence: number
  channel: string
  args: unknown[]
}

type Listener = (event: HostEvent) => void

function estimateHostEventBytes(event: HostEvent): number {
  let bytes = 64 + Buffer.byteLength(event.channel, "utf8")
  for (const arg of event.args) {
    if (typeof arg === "string") bytes += Buffer.byteLength(arg, "utf8")
    else {
      try {
        bytes += Buffer.byteLength(JSON.stringify(arg) ?? "", "utf8")
      } catch {
        bytes += 64
      }
    }
  }
  return bytes
}

export class EventHub {
  private sequence = 0
  private readonly history: HostEvent[] = []
  private historyBytes = 0
  private readonly listeners = new Set<Listener>()
  private readonly capacity: number
  private readonly maxHistoryBytes: number

  constructor(capacity = 1024, maxHistoryBytes = 16 * 1024 * 1024) {
    this.capacity = capacity
    this.maxHistoryBytes = maxHistoryBytes
  }

  emit(channel: string, args: unknown[]): HostEvent {
    this.sequence += 1
    const event: HostEvent = {
      protocolVersion: 1,
      sequence: this.sequence,
      channel,
      args,
    }
    const eventBytes = estimateHostEventBytes(event)
    this.history.push(event)
    this.historyBytes += eventBytes
    while (
      this.history.length > 1 &&
      (this.history.length > this.capacity || this.historyBytes > this.maxHistoryBytes)
    ) {
      const dropped = this.history.shift()!
      this.historyBytes -= estimateHostEventBytes(dropped)
    }
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
