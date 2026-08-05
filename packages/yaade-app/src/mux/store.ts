import type { MuxStatePersisted, TabOrientation } from "./types.js"

export const MUX_STORAGE_KEY = "yaade-mux-v1"

export const DEFAULT_MUX_STATE: MuxStatePersisted = {
  version: 2,
  orientation: "horizontal",
  windows: [],
  activeWindowId: null,
  lastCwdUri: null,
  gitRoots: {},
}

function isOrientation(value: unknown): value is TabOrientation {
  return value === "horizontal" || value === "vertical"
}

export function readMuxState(
  storage: Pick<Storage, "getItem"> = localStorage,
): MuxStatePersisted {
  try {
    const raw = storage.getItem(MUX_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_MUX_STATE, gitRoots: {} }
    const parsed = JSON.parse(raw) as Partial<MuxStatePersisted>
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      !Array.isArray(parsed.windows)
    ) {
      return { ...DEFAULT_MUX_STATE, gitRoots: {} }
    }
    // v1 → v2: keep windows; default orientation was vertical — migrate to
    // horizontal only when the stored value was the old implicit default and
    // the user never toggled. Preserve an explicit vertical choice.
    const orientation = isOrientation(parsed.orientation)
      ? parsed.orientation
      : "horizontal"
    return {
      version: 2,
      orientation,
      windows: parsed.windows,
      activeWindowId:
        typeof parsed.activeWindowId === "string"
          ? parsed.activeWindowId
          : null,
      lastCwdUri:
        typeof parsed.lastCwdUri === "string" ? parsed.lastCwdUri : null,
      gitRoots:
        parsed.gitRoots && typeof parsed.gitRoots === "object"
          ? (parsed.gitRoots as Record<string, string>)
          : {},
    }
  } catch {
    return { ...DEFAULT_MUX_STATE, gitRoots: {} }
  }
}

export function writeMuxState(
  state: MuxStatePersisted,
  storage?: Pick<Storage, "setItem">,
): void {
  const store =
    storage ??
    (typeof localStorage !== "undefined"
      ? localStorage
      : ({ setItem() {} } as Pick<Storage, "setItem">))
  try {
    store.setItem(
      MUX_STORAGE_KEY,
      JSON.stringify({ ...state, version: 2 } satisfies MuxStatePersisted),
    )
  } catch {
    /* localStorage may be disabled */
  }
}
