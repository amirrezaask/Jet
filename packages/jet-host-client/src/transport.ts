/** Platform-neutral bridge between the renderer and the Jet host process. */
export interface JetHostTransport {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>
  on(channel: string, listener: (...args: unknown[]) => void): () => void
}
