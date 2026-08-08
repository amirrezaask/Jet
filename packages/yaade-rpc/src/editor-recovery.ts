export const MAX_EDITOR_RECOVERY_BUFFER_BYTES = 16 * 1024 * 1024
export const MAX_EDITOR_RECOVERY_SESSION_BYTES = 64 * 1024 * 1024

export type EditorRecoveryBufferSummary = {
  sessionId: string
  uri: string
  baseVersion: string | null
  languageId: string
  contentBytes: number
  updatedAt: string
}

export type EditorRecoveryBuffer = EditorRecoveryBufferSummary & {
  content: string
}

export function isEditorRecoveryBufferSummary(
  value: unknown,
): value is EditorRecoveryBufferSummary {
  if (!value || typeof value !== "object") return false
  return (
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "uri" in value &&
    typeof value.uri === "string" &&
    "baseVersion" in value &&
    (value.baseVersion === null || typeof value.baseVersion === "string") &&
    "languageId" in value &&
    typeof value.languageId === "string" &&
    "contentBytes" in value &&
    typeof value.contentBytes === "number" &&
    Number.isSafeInteger(value.contentBytes) &&
    value.contentBytes >= 0 &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  )
}
