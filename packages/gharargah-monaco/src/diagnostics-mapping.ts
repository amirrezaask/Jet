export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }

export type LspDiagnosticTag = 1 | 2

export type LspRelatedInformation = {
  location: { uri: string; range: LspRange }
  message: string
}

export type LspDiagnostic = {
  range: LspRange
  message: string
  severity?: number
  code?: string | number
  source?: string
  tags?: LspDiagnosticTag[]
  relatedInformation?: LspRelatedInformation[]
}

export const LspDiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const

export const LspDiagnosticTag = {
  Unnecessary: 1,
  Deprecated: 2,
} as const

/** Monaco MarkerSeverity-compatible values (pure, no monaco import). */
export const MonacoMarkerSeverity = {
  Hint: 1,
  Info: 2,
  Warning: 4,
  Error: 8,
} as const

export const MonacoMarkerTag = {
  Unnecessary: 1,
  Deprecated: 2,
} as const

export type MonacoMarkerData = {
  severity: number
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  code?: string
  source?: string
  tags?: number[]
  relatedInformation?: {
    resource: string
    message: string
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }[]
}

export function lspSeverityToMarkerSeverity(severity: number | undefined): number {
  switch (severity) {
    case LspDiagnosticSeverity.Error:
      return MonacoMarkerSeverity.Error
    case LspDiagnosticSeverity.Warning:
      return MonacoMarkerSeverity.Warning
    case LspDiagnosticSeverity.Information:
      return MonacoMarkerSeverity.Info
    case LspDiagnosticSeverity.Hint:
      return MonacoMarkerSeverity.Hint
    default:
      return MonacoMarkerSeverity.Error
  }
}

export function lspTagsToMarkerTags(tags: LspDiagnosticTag[] | undefined): number[] | undefined {
  if (!tags?.length) return undefined
  const out: number[] = []
  for (const tag of tags) {
    if (tag === LspDiagnosticTag.Unnecessary) out.push(MonacoMarkerTag.Unnecessary)
    if (tag === LspDiagnosticTag.Deprecated) out.push(MonacoMarkerTag.Deprecated)
  }
  return out.length > 0 ? out : undefined
}

export function lspRangeToMonacoRange(range: LspRange): {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
} {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

export function lspDiagnosticToMarker(diagnostic: LspDiagnostic): MonacoMarkerData {
  return {
    severity: lspSeverityToMarkerSeverity(diagnostic.severity),
    message: diagnostic.message,
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLineNumber: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
    code: diagnostic.code != null ? String(diagnostic.code) : undefined,
    source: diagnostic.source,
    tags: lspTagsToMarkerTags(diagnostic.tags),
    relatedInformation: diagnostic.relatedInformation?.map(info => ({
      resource: info.location.uri,
      message: info.message,
      startLineNumber: info.location.range.start.line + 1,
      startColumn: info.location.range.start.character + 1,
      endLineNumber: info.location.range.end.line + 1,
      endColumn: info.location.range.end.character + 1,
    })),
  }
}

export function markersForDiagnostics(diagnostics: LspDiagnostic[]): MonacoMarkerData[] {
  return diagnostics.map(lspDiagnosticToMarker)
}
