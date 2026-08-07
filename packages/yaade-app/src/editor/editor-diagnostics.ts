import {
  getFsReadDiagnostics,
  type FsReadDiagnostics,
} from "@yaade/host-client"

export type EditorModelDiagnostic = {
  uri: string
  refCount: number
  ownerCount: number
  lspOwnerCount: number | null
  version: number
  bytes: number
  lines: number
  content: string
}

export type MountedEditorDiagnostic = {
  id: string
  uri: string
  focused: boolean
}

export type EditorLifecycleDiagnostics = {
  mounts: number
  disposals: number
  modelAttaches: number
  modelDetaches: number
}

export type EditorResourceDiagnostic = {
  url: string
  initiatorType: string
  transferBytes: number
  encodedBytes: number
  decodedBytes: number
  durationMs: number
}

export type EditorDiagnostics = {
  models: {
    totalCount: number
    totalBytes: number
    entries: EditorModelDiagnostic[]
  }
  editors: {
    mountedCount: number
    activeUri: string | null
    activeDirty: boolean
    openBuffers: string[]
    entries: MountedEditorDiagnostic[]
  }
  lifecycle: EditorLifecycleDiagnostics
  chunks: EditorResourceDiagnostic[]
  resources: {
    totalCount: number
    totalTransferBytes: number
    totalEncodedBytes: number
    totalDecodedBytes: number
    entries: EditorResourceDiagnostic[]
  }
  fsReads: FsReadDiagnostics
}

type MonacoDiagnosticsSnapshot = {
  models: EditorModelDiagnostic[]
  editors: MountedEditorDiagnostic[]
  activeUri: string | null
  lifecycle: EditorLifecycleDiagnostics
}

let monacoDiagnosticsProvider: (() => MonacoDiagnosticsSnapshot) | null = null

export function setMonacoDiagnosticsProvider(
  provider: () => MonacoDiagnosticsSnapshot,
): void {
  monacoDiagnosticsProvider = provider
}

function resourceEntries(): EditorResourceDiagnostic[] {
  if (typeof performance?.getEntriesByType !== "function") return []
  return (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    .map(entry => ({
      url: entry.name,
      initiatorType: entry.initiatorType,
      transferBytes: entry.transferSize,
      encodedBytes: entry.encodedBodySize,
      decodedBytes: entry.decodedBodySize,
      durationMs: entry.duration,
    }))
    .sort((a, b) => a.url.localeCompare(b.url))
}

function isEditorChunk(resource: EditorResourceDiagnostic): boolean {
  if (!/\.(?:css|m?js)(?:\?|$)/i.test(resource.url)) return false
  return /monaco|lsp|muxeditorpane|editor\.api|editor\.worker|typescript|css\.worker|html\.worker|json\.worker/i.test(
    resource.url,
  )
}

export function getEditorDiagnostics(
  appState: { activeDirty: boolean; openBuffers: string[] },
): EditorDiagnostics {
  const monaco = monacoDiagnosticsProvider?.() ?? {
    models: [],
    editors: [],
    activeUri: null,
    lifecycle: {
      mounts: 0,
      disposals: 0,
      modelAttaches: 0,
      modelDetaches: 0,
    },
  }
  const resources = resourceEntries()
  return {
    models: {
      totalCount: monaco.models.length,
      totalBytes: monaco.models.reduce((sum, model) => sum + model.bytes, 0),
      entries: monaco.models,
    },
    editors: {
      mountedCount: monaco.editors.length,
      activeUri: monaco.activeUri,
      activeDirty: appState.activeDirty,
      openBuffers: [...appState.openBuffers],
      entries: monaco.editors,
    },
    lifecycle: monaco.lifecycle,
    chunks: resources.filter(isEditorChunk),
    resources: {
      totalCount: resources.length,
      totalTransferBytes: resources.reduce((sum, entry) => sum + entry.transferBytes, 0),
      totalEncodedBytes: resources.reduce((sum, entry) => sum + entry.encodedBytes, 0),
      totalDecodedBytes: resources.reduce((sum, entry) => sum + entry.decodedBytes, 0),
      entries: resources,
    },
    fsReads: getFsReadDiagnostics(),
  }
}
