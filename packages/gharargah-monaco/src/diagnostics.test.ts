import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  lspSeverityToMarkerSeverity,
  lspTagsToMarkerTags,
  lspDiagnosticToMarker,
  markersForDiagnostics,
  LspDiagnosticSeverity,
  LspDiagnosticTag,
  MonacoMarkerSeverity,
  MonacoMarkerTag,
  type LspDiagnostic,
} from "./diagnostics-mapping.js"

describe("lspSeverityToMarkerSeverity", () => {
  it("maps LSP severities", () => {
    assert.equal(lspSeverityToMarkerSeverity(LspDiagnosticSeverity.Error), MonacoMarkerSeverity.Error)
    assert.equal(lspSeverityToMarkerSeverity(LspDiagnosticSeverity.Warning), MonacoMarkerSeverity.Warning)
    assert.equal(lspSeverityToMarkerSeverity(LspDiagnosticSeverity.Information), MonacoMarkerSeverity.Info)
    assert.equal(lspSeverityToMarkerSeverity(LspDiagnosticSeverity.Hint), MonacoMarkerSeverity.Hint)
  })

  it("defaults to error for unknown severity", () => {
    assert.equal(lspSeverityToMarkerSeverity(undefined), MonacoMarkerSeverity.Error)
  })
})

describe("lspTagsToMarkerTags", () => {
  it("maps unnecessary and deprecated tags", () => {
    const tags = lspTagsToMarkerTags([LspDiagnosticTag.Unnecessary, LspDiagnosticTag.Deprecated])
    assert.deepEqual(tags, [MonacoMarkerTag.Unnecessary, MonacoMarkerTag.Deprecated])
  })

  it("returns undefined for empty tags", () => {
    assert.equal(lspTagsToMarkerTags(undefined), undefined)
    assert.equal(lspTagsToMarkerTags([]), undefined)
  })
})

describe("lspDiagnosticToMarker", () => {
  const diagnostic: LspDiagnostic = {
    range: {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 5 },
    },
    message: "test error",
    severity: LspDiagnosticSeverity.Warning,
    code: "TS1234",
    source: "typescript",
    tags: [LspDiagnosticTag.Deprecated],
    relatedInformation: [
      {
        location: {
          uri: "file:///tmp/foo.ts",
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
        },
        message: "see also",
      },
    ],
  }

  it("converts range to 1-based Monaco coordinates", () => {
    const marker = lspDiagnosticToMarker(diagnostic)
    assert.equal(marker.startLineNumber, 1)
    assert.equal(marker.startColumn, 3)
    assert.equal(marker.endLineNumber, 1)
    assert.equal(marker.endColumn, 6)
  })

  it("maps severity, code, source, tags", () => {
    const marker = lspDiagnosticToMarker(diagnostic)
    assert.equal(marker.severity, MonacoMarkerSeverity.Warning)
    assert.equal(marker.message, "test error")
    assert.equal(marker.code, "TS1234")
    assert.equal(marker.source, "typescript")
    assert.deepEqual(marker.tags, [MonacoMarkerTag.Deprecated])
  })

  it("maps related information", () => {
    const marker = lspDiagnosticToMarker(diagnostic)
    assert.equal(marker.relatedInformation?.length, 1)
    assert.equal(marker.relatedInformation?.[0]?.message, "see also")
    assert.equal(marker.relatedInformation?.[0]?.startLineNumber, 2)
  })

  it("batch converts via markersForDiagnostics", () => {
    const markers = markersForDiagnostics([diagnostic])
    assert.equal(markers.length, 1)
    assert.equal(markers[0]?.message, "test error")
  })
})
