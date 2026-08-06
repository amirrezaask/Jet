/**
 * @deprecated Prefer {@link useFileDrop} from `../use-file-drop.js`.
 * Kept so existing imports keep compiling; no-op — MuxApp / legacy App wire `useFileDrop`.
 */
export function useTerminalFileDrop(): void {
  // File drops handled by useFileDrop in MuxApp (HTML5 DataTransfer + path/uri-list).
}
