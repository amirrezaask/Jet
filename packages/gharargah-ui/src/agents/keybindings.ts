import {
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ModelPickerJumpKeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "@gharargah/agents"

export function modelPickerJumpCommandForIndex(
  index: number,
): ModelPickerJumpKeybindingCommand | null {
  return MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[index] ?? null
}

export function modelPickerJumpIndexFromCommand(command: string): number | null {
  const index = (MODEL_PICKER_JUMP_KEYBINDING_COMMANDS as readonly string[]).indexOf(command)
  return index === -1 ? null : index
}

const DIGIT_JUMP: Record<string, string> = {
  Digit1: MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[0]!,
  Digit2: MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[1]!,
  Digit3: MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[2]!,
  Digit4: MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[3]!,
  Digit5: MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[4]!,
  Digit6: MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[5]!,
  Digit7: MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[6]!,
  Digit8: MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[7]!,
  Digit9: MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[8]!,
}

/** Resolve model-picker jump shortcuts (Digit1–9). Other chords stay unbound. */
export function resolveShortcutCommand(
  event: { code?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean },
  _keybindings: ResolvedKeybindingsConfig,
  _options?: unknown,
): string | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null
  const code = event.code
  if (!code) return null
  return DIGIT_JUMP[code] ?? null
}

export function shortcutLabelForCommand(
  _keybindings: ResolvedKeybindingsConfig,
  command: string,
  _options?: unknown,
): string | null {
  const index = modelPickerJumpIndexFromCommand(command)
  if (index == null) return null
  return String(index + 1)
}
