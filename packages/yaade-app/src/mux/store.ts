import type { MuxStatePersisted, TabOrientation } from "./types.js"

export const MUX_STORAGE_KEY = "yaade-mux-v1"

export const DEFAULT_MUX_STATE: MuxStatePersisted = {
  version: 1,
  orientation: "vertical",
  windows: [],
  activeWindowId: null,
  lastCwdUri: null,
}

function isOrientation(value: unknown): value is TabOrientation {
  return value === "horizontal" || value === "vertical"
}

export function readMuxState(
  storage: Pick<Storage, "getItem"> = localStorage,
): MuxStatePersisted {
  try {
    const raw = storage.getItem(MUX_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_MUX_STATE }
    const parsed = JSON.parse(raw) as Partial<MuxStatePersisted>
    if (parsed.version !== 1 || !Array.isArray(parsed.windows)) {
      return { ...DEFAULT_MUX_STATE }
    }
    return {
      version: 1,
      orientation: isOrientation(parsed.orientation)
        ? parsed.orientation
        : "vertical",
      windows: parsed.windows,
      activeWindowId:
        typeof parsed.activeWindowId === "string"
          ? parsed.activeWindowId
          : null,
      lastCwdUri:
        typeof parsed.lastCwdUri === "string" ? parsed.lastCwdUri : null,
    }
  } catch {
    return { ...DEFAULT_MUX_STATE }
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
    store.setItem(MUX_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* localStorage may be disabled */
  }
}
