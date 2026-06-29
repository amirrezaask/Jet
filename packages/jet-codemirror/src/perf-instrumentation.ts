const enabled =
  typeof performance !== "undefined" && typeof performance.mark === "function"

export function perfMeasure(name: string, run: () => void): void {
  if (!enabled) {
    run()
    return
  }
  performance.mark(`${name}:start`)
  run()
  performance.mark(`${name}:end`)
  performance.measure(name, `${name}:start`, `${name}:end`)
}

export async function perfMeasureAsync(name: string, run: () => Promise<void>): Promise<void> {
  if (!enabled) {
    await run()
    return
  }
  performance.mark(`${name}:start`)
  await run()
  performance.mark(`${name}:end`)
  performance.measure(name, `${name}:start`, `${name}:end`)
}
