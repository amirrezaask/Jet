type TerminalKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "isComposing" | "key" | "metaKey" | "shiftKey" | "type"
>

function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform)
}

export function terminalKeybindingData(
  event: TerminalKeyboardEvent,
  platform: string,
): string | null {
  if (event.type !== "keydown" || event.isComposing) return null

  if (
    event.key === "Enter" &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    return "\n"
  }

  if (!isMacPlatform(platform) || event.shiftKey || event.ctrlKey) return null

  if (event.key === "ArrowLeft") {
    if (event.altKey && !event.metaKey) return "\u001bb"
    if (event.metaKey && !event.altKey) return "\u0001"
  }
  if (event.key === "ArrowRight") {
    if (event.altKey && !event.metaKey) return "\u001bf"
    if (event.metaKey && !event.altKey) return "\u0005"
  }
  if (event.key === "Backspace") {
    if (event.altKey && !event.metaKey) return "\u001b\u007f"
    if (event.metaKey && !event.altKey) return "\u0015"
  }
  return null
}
