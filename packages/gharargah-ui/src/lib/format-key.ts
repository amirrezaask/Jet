const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

function formatKeyPart(part: string): string {
  const tokens = part.split("-")
  const key = tokens.pop() ?? part
  const mods = tokens.map(t => {
    switch (t) {
      case "Cmd":
        return isMac ? "⌘" : "Ctrl"
      case "Ctrl":
        return "Ctrl"
      case "Alt":
        return isMac ? "⌥" : "Alt"
      case "Shift":
        return "⇧"
      default:
        return t
    }
  })
  const label =
    key.length === 1
      ? key.toUpperCase()
      : key === "ArrowUp"
        ? "↑"
        : key === "ArrowDown"
          ? "↓"
          : key === "ArrowLeft"
            ? "←"
            : key === "ArrowRight"
              ? "→"
      : key === "`"
        ? "`"
        : key === "Enter"
          ? "↵"
          : key
  return [...mods, label].join("")
}

export function formatKeyBinding(key: string): string {
  return key.split(" ").map(formatKeyPart).join(" ")
}
