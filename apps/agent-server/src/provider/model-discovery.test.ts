import assert from "node:assert/strict"
import { test } from "node:test"
import {
  parseCodexModelItem,
  parseCursorListAvailableModels,
  parseCursorModelsOutput,
  parseOpenCodeModelsOutput,
  parseSessionModelState,
  clearModelDiscoveryCache,
  listCachedModels,
} from "./model-discovery.js"

test("parseCursorModelsOutput matches rust line format", () => {
  const models = parseCursorModelsOutput(`Available models
composer-1 - Composer 1 (default)
claude-4-sonnet - Claude 4 Sonnet
gpt-5 - GPT-5
`)
  assert.equal(models.length, 3)
  assert.equal(models[0]?.slug, "composer-1")
  assert.equal(models[0]?.name, "Composer 1")
  assert.equal(models[1]?.slug, "claude-4-sonnet")
})

test("parseOpenCodeModelsOutput keeps provider/model slugs", () => {
  const models = parseOpenCodeModelsOutput(`anthropic/claude-sonnet-4
openai/gpt-5
auto
bad slug
`)
  assert.equal(models.length, 2)
  assert.equal(models[0]?.slug, "anthropic/claude-sonnet-4")
  assert.equal(models[0]?.shortName, "claude-sonnet-4")
})

test("parseCodexModelItem skips hidden + maps reasoning efforts", () => {
  assert.equal(parseCodexModelItem({ model: "x", hidden: true }), null)
  const m = parseCodexModelItem({
    model: "o3",
    displayName: "o3",
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "high" },
    ],
  })
  assert.equal(m?.slug, "o3")
  assert.equal(m?.configOptions?.[0]?.id, "reasoning_effort")
  assert.deepEqual(
    m?.configOptions?.[0]?.values?.map(v => v.value),
    ["low", "high"],
  )
})

test("parseCursorListAvailableModels + session model state", () => {
  const cursor = parseCursorListAvailableModels({
    models: [
      { value: "composer", name: "Composer", configOptions: [] },
      { value: "gpt-5", name: "GPT-5" },
    ],
  })
  assert.equal(cursor.length, 2)
  assert.equal(cursor[0]?.slug, "composer")

  const session = parseSessionModelState({
    currentModelId: "a",
    availableModels: [
      { modelId: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ],
  })
  assert.equal(session.length, 2)
  assert.equal(session[0]?.slug, "a")
  assert.equal(session[1]?.slug, "b")
})

test("listCachedModels mock catalog", () => {
  clearModelDiscoveryCache()
  process.env.GHARARGAH_AGENT_MOCK = "1"
  try {
    const cursor = listCachedModels("cursor")
    assert.ok(cursor.some(m => m.slug === "mock-composer"))
    const codex = listCachedModels("codex")
    assert.ok(codex.some(m => m.slug === "mock-codex"))
  } finally {
    delete process.env.GHARARGAH_AGENT_MOCK
    clearModelDiscoveryCache()
  }
})
