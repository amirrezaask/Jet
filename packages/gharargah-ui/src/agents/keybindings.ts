import {
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ModelPickerJumpKeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "./t3contracts.js"

export function modelPickerJumpCommandForIndex(
  index: number,
): ModelPickerJumpKeybindingCommand | null {
  return MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[index] ?? null
}

export function modelPickerJumpIndexFromCommand(command: string): number | null {
  const index = (MODEL_PICKER_JUMP_KEYBINDING_COMMANDS as readonly string[]).indexOf(command)
  return index === -1 ? null : index
}

export function resolveShortcutCommand(
  _event: unknown,
  _keybindings: ResolvedKeybindingsConfig,
  _options?: unknown,
): string | null {
  return null
}

export function shortcutLabelForCommand(
  _keybindings: ResolvedKeybindingsConfig,
  _command: string,
  _options?: unknown,
): string | null {
  return null
}
