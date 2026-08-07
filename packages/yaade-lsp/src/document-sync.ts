import { TextDocumentSyncKind } from "vscode-languageserver-protocol"

export type MonacoContentChange = {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  rangeLength: number
  text: string
}

export type LspContentChange =
  | { text: string }
  | {
      range: {
        start: { line: number; character: number }
        end: { line: number; character: number }
      }
      rangeLength: number
      text: string
    }

/** Convert Monaco changes without serializing the document for incremental sync. */
export function lspContentChanges(
  syncKind: TextDocumentSyncKind,
  changes: readonly MonacoContentChange[],
  fullText: () => string,
): LspContentChange[] {
  if (syncKind === TextDocumentSyncKind.None) return []
  if (syncKind === TextDocumentSyncKind.Full) return [{ text: fullText() }]
  return changes.map(change => ({
    range: {
      start: {
        line: change.range.startLineNumber - 1,
        character: change.range.startColumn - 1,
      },
      end: {
        line: change.range.endLineNumber - 1,
        character: change.range.endColumn - 1,
      },
    },
    rangeLength: change.rangeLength,
    text: change.text,
  }))
}
