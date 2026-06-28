import type { JetCommandFn } from "./commands.js"

/** Shell command fns passed to createDefaultKeybindings(cmd). */
export type JetCommands = Record<string, JetCommandFn>
