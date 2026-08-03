export type Utf16Position = { line: number; character: number }

function isCrLf(text: string, index: number): boolean {
  return text.charCodeAt(index) === 13 && index + 1 < text.length && text.charCodeAt(index + 1) === 10
}

/** Convert a JS string offset to an LSP UTF-16 position (0-based line/character). */
export function offsetToPosition(text: string, offset: number): Utf16Position {
  let line = 0
  let character = 0
  const limit = Math.max(0, Math.min(offset, text.length))

  for (let i = 0; i < limit; i++) {
    const code = text.charCodeAt(i)
    if (code === 13) {
      if (isCrLf(text, i)) {
        line++
        character = 0
        i++
      } else {
        line++
        character = 0
      }
    } else if (code === 10) {
      line++
      character = 0
    } else {
      character++
    }
  }

  return { line, character }
}

/** Convert an LSP UTF-16 position to a JS string offset. */
export function positionToOffset(text: string, pos: Utf16Position): number {
  let line = 0
  let character = 0

  for (let i = 0; i < text.length; i++) {
    if (line === pos.line && character === pos.character) return i

    const code = text.charCodeAt(i)
    if (code === 13) {
      if (isCrLf(text, i)) {
        line++
        character = 0
        i++
      } else {
        line++
        character = 0
      }
    } else if (code === 10) {
      line++
      character = 0
    } else {
      character++
    }
  }

  if (line === pos.line && character === pos.character) return text.length
  return text.length
}
