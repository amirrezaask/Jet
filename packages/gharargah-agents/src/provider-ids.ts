/** Branded provider identity types used by the agent picker UI. */

export type ProviderInstanceId = string & { readonly __brand: "ProviderInstanceId" }
export type ProviderDriverKind = string & { readonly __brand: "ProviderDriverKind" }

export const ProviderDriverKind = {
  make(value: string): ProviderDriverKind {
    return value as ProviderDriverKind
  },
}

export function asProviderInstanceId(value: string): ProviderInstanceId {
  return value as ProviderInstanceId
}

export type ModelPickerJumpKeybindingCommand = `modelPicker.jump.${number}`

export const MODEL_PICKER_JUMP_KEYBINDING_COMMANDS = [
  "modelPicker.jump.1",
  "modelPicker.jump.2",
  "modelPicker.jump.3",
  "modelPicker.jump.4",
  "modelPicker.jump.5",
  "modelPicker.jump.6",
  "modelPicker.jump.7",
  "modelPicker.jump.8",
  "modelPicker.jump.9",
] as const satisfies readonly ModelPickerJumpKeybindingCommand[]

export type ResolvedKeybindingsConfig = Record<string, unknown>
