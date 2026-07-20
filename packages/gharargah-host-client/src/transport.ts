/** Platform-neutral bridge between the renderer and the Gharargah host process. */
export interface GharargahHostTransport {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>
  on(channel: string, listener: (...args: unknown[]) => void): () => void
}
