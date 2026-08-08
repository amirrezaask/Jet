import {
  isEditorRecoveryBufferSummary,
  type EditorRecoveryBuffer,
  type EditorRecoveryBufferSummary,
} from "@yaade/rpc"

type RequestOptions = {
  signal?: AbortSignal
}

function collectionPath(sessionId: string): string {
  return `/api/v1/project-sessions/${encodeURIComponent(sessionId)}/editor-recovery`
}

function bufferPath(sessionId: string, uri: string): string {
  return `${collectionPath(sessionId)}/buffer?uri=${encodeURIComponent(uri)}`
}

async function apiError(response: Response): Promise<Error> {
  let message = `editor recovery API failed (${response.status})`
  try {
    const body: unknown = await response.json()
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      message = body.error.message
    }
  } catch {
    /* keep status message */
  }
  return new Error(message)
}

async function readSummary(
  response: Response,
): Promise<EditorRecoveryBufferSummary> {
  const raw: unknown = await response.json()
  if (!isEditorRecoveryBufferSummary(raw)) {
    throw new Error("editor recovery API returned invalid metadata")
  }
  return raw
}

function decodedHeader(response: Response, name: string): string | null {
  const value = response.headers.get(name)
  if (value === null) return null
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`editor recovery API returned invalid ${name} header`)
  }
}

export async function listEditorRecoveryBuffers(
  sessionId: string,
  options: RequestOptions = {},
): Promise<EditorRecoveryBufferSummary[]> {
  const response = await fetch(collectionPath(sessionId), {
    signal: options.signal,
  })
  if (!response.ok) throw await apiError(response)
  const raw: unknown = await response.json()
  if (!Array.isArray(raw) || !raw.every(isEditorRecoveryBufferSummary)) {
    throw new Error("editor recovery API returned an invalid buffer list")
  }
  return raw
}

export async function getEditorRecoveryBuffer(
  sessionId: string,
  uri: string,
  options: RequestOptions = {},
): Promise<EditorRecoveryBuffer | null> {
  const response = await fetch(bufferPath(sessionId, uri), {
    signal: options.signal,
  })
  if (response.status === 204) return null
  if (
    response.status === 404 ||
    response.headers.get("x-yaade-recovery-missing") === "1"
  ) {
    // Drain the stream before returning. Chromium reports an otherwise-valid
    // HTTP 200 as net::ERR_ABORTED when the caller abandons even an empty GET
    // response body after inspecting only its headers.
    await response.arrayBuffer()
    return null
  }
  if (!response.ok) throw await apiError(response)

  const recoveredUri = decodedHeader(response, "x-yaade-recovery-uri")
  const languageId = decodedHeader(response, "x-yaade-recovery-language-id")
  const updatedAt = decodedHeader(response, "x-yaade-recovery-updated-at")
  const baseVersion = decodedHeader(response, "x-yaade-recovery-base-version")
  const contentLength = Number(response.headers.get("content-length"))
  if (
    !recoveredUri ||
    !languageId ||
    !updatedAt ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0
  ) {
    throw new Error("editor recovery API returned invalid buffer metadata")
  }
  const content = await response.text()
  return {
    sessionId,
    uri: recoveredUri,
    baseVersion,
    languageId,
    contentBytes: contentLength,
    updatedAt,
    content,
  }
}

export async function upsertEditorRecoveryBuffer(
  input: {
    sessionId: string
    uri: string
    content: string
    baseVersion: string | null
    languageId: string
  },
  options: RequestOptions = {},
): Promise<EditorRecoveryBufferSummary> {
  const query = new URLSearchParams({
    uri: input.uri,
    languageId: input.languageId,
  })
  if (input.baseVersion !== null) query.set("baseVersion", input.baseVersion)
  const response = await fetch(
    `${collectionPath(input.sessionId)}/buffer?${query.toString()}`,
    {
      method: "PUT",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: input.content,
      signal: options.signal,
    },
  )
  if (!response.ok) throw await apiError(response)
  return readSummary(response)
}

export async function deleteEditorRecoveryBuffer(
  sessionId: string,
  uri: string,
  options: RequestOptions = {},
): Promise<boolean> {
  const response = await fetch(bufferPath(sessionId, uri), {
    method: "DELETE",
    signal: options.signal,
  })
  if (!response.ok) throw await apiError(response)
  const raw: unknown = await response.json()
  return Boolean(
    raw &&
      typeof raw === "object" &&
      "deleted" in raw &&
      raw.deleted === true,
  )
}

export async function deleteEditorRecoverySession(
  sessionId: string,
  options: RequestOptions = {},
): Promise<number> {
  const response = await fetch(collectionPath(sessionId), {
    method: "DELETE",
    signal: options.signal,
  })
  if (!response.ok) throw await apiError(response)
  const raw: unknown = await response.json()
  if (
    !raw ||
    typeof raw !== "object" ||
    !("deleted" in raw) ||
    typeof raw.deleted !== "number" ||
    !Number.isSafeInteger(raw.deleted) ||
    raw.deleted < 0
  ) {
    throw new Error("editor recovery API returned an invalid delete count")
  }
  return raw.deleted
}
