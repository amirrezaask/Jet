import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import { canonicalizeFileUri } from "@gharargah/shared"
import {
  lspDiagnosticToMarker,
  type LspDiagnostic,
} from "./diagnostics-mapping.js"

export type {
  LspDiagnostic,
  LspPosition,
  LspRange,
  LspRelatedInformation,
  MonacoMarkerData,
} from "./diagnostics-mapping.js"

export {
  lspSeverityToMarkerSeverity,
  lspTagsToMarkerTags,
  lspRangeToMonacoRange,
  lspDiagnosticToMarker,
  markersForDiagnostics,
  LspDiagnosticSeverity,
  LspDiagnosticTag,
  MonacoMarkerSeverity,
  MonacoMarkerTag,
} from "./diagnostics-mapping.js"

function toMonacoMarker(marker: ReturnType<typeof lspDiagnosticToMarker>): monaco.editor.IMarkerData {
  return {
    ...marker,
    relatedInformation: marker.relatedInformation?.map(info => ({
      ...info,
      resource: monaco.Uri.parse(canonicalizeFileUri(info.resource)),
    })),
  }
}

export function setLspMarkers(uri: string, owner: string, diagnostics: LspDiagnostic[]): void {
  const modelUri = canonicalizeFileUri(uri.startsWith("file://") ? uri : uri)
  const model = monaco.editor.getModel(monaco.Uri.parse(modelUri))
  if (!model) return
  monaco.editor.setModelMarkers(model, owner, diagnostics.map(d => toMonacoMarker(lspDiagnosticToMarker(d))))
}

export function clearLspMarkers(uri: string, owner: string): void {
  const modelUri = canonicalizeFileUri(uri.startsWith("file://") ? uri : uri)
  const model = monaco.editor.getModel(monaco.Uri.parse(modelUri))
  if (!model) return
  monaco.editor.setModelMarkers(model, owner, [])
}
