/**
 * @deprecated Prefer {@link useFileDrop} from `../use-file-drop.js`.
 * Kept so existing imports keep compiling; no-op — App wires `useFileDrop`.
 */
export function useTerminalFileDrop(): void {
  // File drops handled by useFileDrop in App.tsx (HTML5 DataTransfer + path/uri-list).
}
