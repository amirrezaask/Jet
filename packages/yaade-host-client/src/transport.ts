/** Platform-neutral bridge between the renderer and the Yaade host process. */
export interface YaadeHostTransport {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>
  /** Optional per-request cancellation used by intent-driven cold-path queries. */
  invokeWithSignal?<T>(
    channel: string,
    args: unknown[],
    signal: AbortSignal,
  ): Promise<T>
  /**
   * Fire-and-forget realtime send (WebSocket). Returns true when queued on an
   * open socket; false means caller should fall back to `invoke` (HTTP RPC).
   */
  sendRealtime?(channel: string, ...args: unknown[]): boolean
  on(channel: string, listener: (...args: unknown[]) => void): () => void
}
