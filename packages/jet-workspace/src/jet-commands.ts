import type { JetCommandFn } from "./commands.js"

export type JetCommands = Record<string, JetCommandFn>

export const noopCommand: JetCommandFn = () => {}

export function withVscodeStubs(
  named: Record<string, JetCommandFn>,
  vscodeCommandIds: readonly string[],
): JetCommands {
  const stubs = Object.fromEntries(vscodeCommandIds.map(id => [id, noopCommand]))
  return { ...stubs, ...named }
}
