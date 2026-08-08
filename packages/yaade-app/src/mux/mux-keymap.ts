/**
 * Mux keymap for a browser tab.
 *
 * Almost every chord a terminal multiplexer wants (`Mod-t`, `Mod-n`, `Mod-w`,
 * `Mod-1..9`, `Mod-Alt-Arrow`) is owned by the browser and never reaches the
 * page. So mux actions live behind a tmux-style prefix key: one chord opens a
 * namespace, and the browser has no claim on what follows.
 *
 * Only chords that Chromium delivers *and* that no reasonable user expects the
 * browser to handle stay direct.
 */

/** Prefix that opens the mux namespace. */
export const MUX_PREFIX = "Ctrl-a"

export type MuxPrefixBinding = {
  /** Second chord part, appended to {@link MUX_PREFIX}. */
  key: string
  /** Command id in the registry. */
  command: string
  /** Label for the which-key panel. */
  desc: string
}

/**
 * Source of truth for both `registerUser` and the which-key panel, so the hint
 * overlay can never drift from what is actually bound.
 */
export const MUX_PREFIX_BINDINGS: readonly MuxPrefixBinding[] = [
  { key: "c", command: "terminal.new", desc: "New pane" },
  { key: "d", command: "mux.splitRight", desc: "Split right" },
  { key: "Shift-D", command: "mux.splitDown", desc: "Split down" },
  { key: "x", command: "mux.closePane", desc: "Close pane" },
  { key: "z", command: "mux.zoomPane", desc: "Zoom pane" },
  { key: "h", command: "mux.focusLeft", desc: "Focus left" },
  { key: "j", command: "mux.focusDown", desc: "Focus down" },
  { key: "k", command: "mux.focusUp", desc: "Focus up" },
  { key: "l", command: "mux.focusRight", desc: "Focus right" },
  { key: "ArrowLeft", command: "mux.focusLeft", desc: "Focus left" },
  { key: "ArrowDown", command: "mux.focusDown", desc: "Focus down" },
  { key: "ArrowUp", command: "mux.focusUp", desc: "Focus up" },
  { key: "ArrowRight", command: "mux.focusRight", desc: "Focus right" },
  { key: "w", command: "terminal.list", desc: "Switch pane" },
  { key: "t", command: "mux.newWindow", desc: "New browser tab" },
  { key: "n", command: "mux.openNeovim", desc: "Open Neovim" },
  { key: "g", command: "mux.openGit", desc: "Open Git" },
  { key: "e", command: "explorer.focus", desc: "Explorer" },
  { key: "f", command: "editor.quickOpen", desc: "Quick open" },
  { key: "/", command: "editor.projectSearch", desc: "Project search" },
  { key: "s", command: "editor.save", desc: "Save" },
  { key: "p", command: "ui.showCommandPalette", desc: "Command palette" },
  { key: ".", command: "workspace.cd", desc: "Change directory" },
  { key: ",", command: "settings.show", desc: "Settings" },
  { key: "=", command: "ui.zoomIn", desc: "Font bigger" },
  { key: "-", command: "ui.zoomOut", desc: "Font smaller" },
]

/**
 * Chords bound without the prefix. Kept to the minimum that Chromium delivers
 * and that users already expect an app to own.
 */
export const MUX_DIRECT_BINDINGS: readonly {
  key: string
  command: string
  desc: string
}[] = [
  { key: "Mod-Shift-p", command: "ui.showCommandPalette", desc: "Command palette" },
  { key: "Mod-,", command: "settings.show", desc: "Settings" },
]

/** Full binding key for a prefix entry, e.g. `Ctrl-a z`. */
export function muxPrefixBindingKey(key: string, prefix = MUX_PREFIX): string {
  return `${prefix} ${key}`
}

/**
 * Control byte a `Ctrl-<letter>` prefix would have sent to the PTY, so pressing
 * the prefix twice passes it through to the shell (tmux's send-prefix).
 * Returns `null` for prefixes with no control-code equivalent.
 */
export function prefixLiteralByte(prefix = MUX_PREFIX): string | null {
  const match = /^Ctrl-([a-z])$/i.exec(prefix.trim())
  if (!match) return null
  const letter = match[1]!.toLowerCase()
  const code = letter.charCodeAt(0) - 96
  if (code < 1 || code > 26) return null
  return String.fromCharCode(code)
}
