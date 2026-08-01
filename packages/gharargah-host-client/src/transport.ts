/** Platform-neutral bridge between the renderer and the Gharargah host process. */
export interface GharargahHostTransport {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>
  /** Optional per-request cancellation used by intent-driven cold-path queries. */
  invokeWithSignal?<T>(
    channel: string,
    args: unknown[],
    signal: AbortSignal,
  ): Promise<T>
  on(channel: string, listener: (...args: unknown[]) => void): () => void
}
