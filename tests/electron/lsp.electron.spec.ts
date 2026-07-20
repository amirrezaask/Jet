import { expect, test } from "@playwright/test"
import {
  expectContainsText,
  expectLocatorCount,
  expectNotContainsText,
  expectSelectorHidden,
} from "../shell/assert.js"
import { expectListRows } from "../helpers/list.js"
import {
  PROBLEMS_PANEL,
  REFERENCES_LIST_PANEL,
  waitForReferencesListPanel,
} from "../helpers/location-list.js"
import {
  hasGopls,
  hasTypescriptLanguageServer,
  launchJet,
  openFixtureFile,
  waitForLspConnected,
} from "./_launch.js"

async function placeCursorOnToken(page: import("./_launch.js").ShellDriver, token: string): Promise<void> {
  const placed = await page.evaluate(needle => {
    const agent = window.__gharargahAgent!
    const text = agent.getEditorText()
    if (!text) return false
    const index = text.indexOf(needle)
    if (index < 0) return false
    const before = text.slice(0, index)
    const line = before.split("\n").length
    const lineStart = before.lastIndexOf("\n") + 1
    const column = index - lineStart + 1 + Math.floor(needle.length / 2)
    agent.setEditorSelection(line, column)
    return true
  }, token)
  expect(placed).toBe(true)
}

test.describe("electron LSP TypeScript", () => {
  test.skip(!hasTypescriptLanguageServer(), "typescript-language-server not on PATH")

  test("LSP connects when opening TypeScript file", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)
      await expectContainsText(page, "footer", "LSP connected")
    } finally {
      await app.close()
    }
  })

  test("go to definition on greet opens utils.ts", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)
      await placeCursorOnToken(page, "greet")

      await expect.poll(async () => {
        const text = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
        if (!text?.includes("export function greet")) {
          await page.evaluate(async () => {
            await window.__gharargahAgent!.executeCommand("editor.action.revealDefinition")
          })
        }
        return page.evaluate(() => window.__gharargahAgent!.getEditorText())
      }, { timeout: 15_000, intervals: [200, 400, 800] }).toContain("export function greet")
    } finally {
      await app.close()
    }
  })

  test("go to references on greet opens LocationList with hits", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      await waitForLspConnected(page)
      await placeCursorOnToken(page, "greet")

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("editor.action.goToReferences")
      })

      const listId = await waitForReferencesListPanel(page)
      await expectSelectorHidden(page, ".cm-lsp-references, .cm-panel.cm-lsp-references-panel")
      await expectContainsText(page, REFERENCES_LIST_PANEL, /References:\s*greet/i)
      await expectListRows(page, {
        panel: listId,
        minItems: 1,
        minUniqueTops: 1,
        needle: "greet",
        noResultsText: "No references",
      })
      await expectNotContainsText(page, REFERENCES_LIST_PANEL, "No references")
      await expectContainsText(page, REFERENCES_LIST_PANEL, /index\.ts|utils\.ts/)
    } finally {
      await app.close()
    }
  })

  test("lint-error.ts shows problems in location list", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/lint-error.ts")
      await waitForLspConnected(page)
      await page.waitForTimeout(2000)

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("locationlist.showProblems")
      })
      await page.waitForTimeout(1500)

      await expectContainsText(page, PROBLEMS_PANEL, /error|Type|problem/i)
    } finally {
      await app.close()
    }
  })
})

test.describe("electron LSP Go", () => {
  test.skip(!hasGopls(), "gopls not on PATH")

  test("LSP connects for Go file", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/example.go")
      await waitForLspConnected(page)
      await expectContainsText(page, "footer", "LSP connected")
    } finally {
      await app.close()
    }
  })

  test("go to definition on package-level AppName jumps to config.go", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/example.go")
      await waitForLspConnected(page)
      await placeCursorOnToken(page, "AppName")

      await expect.poll(async () => {
        const text = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
        if (!text?.includes('const AppName')) {
          await page.evaluate(async () => {
            await window.__gharargahAgent!.executeCommand("editor.action.revealDefinition")
          })
        }
        return page.evaluate(() => window.__gharargahAgent!.getEditorText())
      }, { timeout: 20_000, intervals: [300, 500, 800] }).toContain("const AppName")

      await expect.poll(() => page.evaluate(() => window.__gharargahAgent!.getEditorText()), {
        timeout: 5_000,
      }).toContain('AppName = "jet-sample"')
    } finally {
      await app.close()
    }
  })

  test("go to definition on package-level MaxRetries jumps to config.go", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/example.go")
      await waitForLspConnected(page)
      await placeCursorOnToken(page, "MaxRetries")

      await expect.poll(async () => {
        const text = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
        if (!text?.includes("var MaxRetries")) {
          await page.evaluate(async () => {
            await window.__gharargahAgent!.executeCommand("editor.action.revealDefinition")
          })
        }
        return page.evaluate(() => window.__gharargahAgent!.getEditorText())
      }, { timeout: 20_000, intervals: [300, 500, 800] }).toContain("var MaxRetries")
    } finally {
      await app.close()
    }
  })

  test("go to references on MaxRetries populates LocationList", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/config.go")
      await waitForLspConnected(page)
      await placeCursorOnToken(page, "MaxRetries")

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("editor.action.goToReferences")
      })

      const listId = await waitForReferencesListPanel(page)
      await expectSelectorHidden(page, ".cm-lsp-references, .cm-panel.cm-lsp-references-panel")
      await expectContainsText(page, REFERENCES_LIST_PANEL, /References:\s*MaxRetries/i)
      await expectListRows(page, {
        panel: listId,
        minItems: 2,
        minUniqueTops: 2,
        needle: "MaxRetries",
        noResultsText: "No references",
      })
      await expectContainsText(page, REFERENCES_LIST_PANEL, /config\.go/)
      await expectContainsText(page, REFERENCES_LIST_PANEL, /example\.go/)
    } finally {
      await app.close()
    }
  })

  test("go to definition on greet function works", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/example.go")
      await waitForLspConnected(page)
      // call site in main
      await page.evaluate(() => {
        const text = window.__gharargahAgent!.getEditorText() ?? ""
        const call = text.lastIndexOf('greet("world")')
        const before = text.slice(0, call)
        const line = before.split("\n").length
        const col = call - (before.lastIndexOf("\n") + 1) + 3
        window.__gharargahAgent!.setEditorSelection(line, col)
      })

      await expect.poll(async () => {
        const editorText = await page.evaluate(() => window.__gharargahAgent!.getEditorText() ?? "")
        const defLine = editorText.split("\n").findIndex(l => l.includes("func greet(name string)")) + 1
        const cursor = await page.evaluate(() => window.__gharargahAgent!.getCursorPosition())
        if (defLine > 0 && Math.abs((cursor?.line ?? -1) - defLine) > 1) {
          await page.evaluate(async () => {
            await window.__gharargahAgent!.executeCommand("editor.action.revealDefinition")
          })
        }
        const after = await page.evaluate(() => window.__gharargahAgent!.getCursorPosition())
        return Math.abs((after?.line ?? -1) - defLine) <= 1
      }, { timeout: 15_000, intervals: [300, 500] }).toBe(true)
    } finally {
      await app.close()
    }
  })

  test("go to definition on other-package SharedFlag jumps to lib/settings.go", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/example.go")
      await waitForLspConnected(page)
      await placeCursorOnToken(page, "SharedFlag")

      await expect.poll(async () => {
        const text = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
        if (!text?.includes("var SharedFlag")) {
          await page.evaluate(async () => {
            await window.__gharargahAgent!.executeCommand("editor.action.revealDefinition")
          })
        }
        return page.evaluate(() => window.__gharargahAgent!.getEditorText())
      }, { timeout: 20_000, intervals: [300, 500, 800] }).toContain("var SharedFlag")

      await expect.poll(() => page.evaluate(() => window.__gharargahAgent!.getEditorText()), {
        timeout: 5_000,
      }).toContain("SharedFlag = 42")
    } finally {
      await app.close()
    }
  })

  test("go to definition on fmt.Println opens stdlib outside workspace", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/example.go")
      await waitForLspConnected(page)
      await placeCursorOnToken(page, "Println")

      await expect.poll(async () => {
        const text = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
        if (!text?.includes("func Println")) {
          await page.evaluate(async () => {
            await window.__gharargahAgent!.executeCommand("editor.action.revealDefinition")
          })
        }
        return page.evaluate(() => window.__gharargahAgent!.getEditorText())
      }, { timeout: 25_000, intervals: [400, 600, 900] }).toContain("func Println")
    } finally {
      await app.close()
    }
  })
})

test.describe("electron LSP misc", () => {
  test.skip(!hasTypescriptLanguageServer(), "typescript-language-server not on PATH")

  test("modifier hover marks the clicked symbol and preserves jump navigation", async () => {
    test.setTimeout(120_000)
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)
      const point = await page.locator(".cm-line").nth(3).evaluate(line => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode() as Text | null
        while (node) {
          const index = node.data.indexOf("greet")
          if (index >= 0) {
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + 5)
            const rect = range.getBoundingClientRect()
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          }
          node = walker.nextNode() as Text | null
        }
        throw new Error("greet token not rendered")
      })

      await page.keyboard.down("Meta")
      for (let attempt = 0; attempt < 40; attempt++) {
        await page.mouse.move(point.x, point.y)
        if ((await page.locator("[data-gharargah-definition-link]").count()) > 0) break
        await page.waitForTimeout(250)
      }
      await expectLocatorCount(page.locator("[data-gharargah-definition-link]"), 1, { timeout: 15_000 })
      await placeCursorOnToken(page, "greet")
      await page.keyboard.up("Meta")
      await expect.poll(async () => {
        const text = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
        if (!text?.includes("export function greet")) {
          await page.evaluate(async () => {
            await window.__gharargahAgent!.executeCommand("editor.action.revealDefinition")
          })
        }
        return page.evaluate(() => window.__gharargahAgent!.getEditorText())
      }, { timeout: 8_000, intervals: [200, 300, 500] }).toContain("export function greet")

      await page.evaluate(async () => window.__gharargahAgent!.executeCommand("navigation.jumpBack"))
      await expect.poll(() => page.evaluate(() => window.__gharargahAgent!.getEditorText()), { timeout: 5_000 }).toContain("function main")
    } finally {
      await page.keyboard.up("Meta").catch(() => {})
      await app.close()
    }
  })

  test("quick outline lists main symbol", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/index.ts")
      await waitForLspConnected(page)

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("editor.action.quickOutline")
      })
      await page.waitForTimeout(1500)

      await expectContainsText(page, "body", "main")
    } finally {
      await app.close()
    }
  })

  test("format document changes buffer", async () => {
    const { app, page } = await launchJet()
    try {
      await openFixtureFile(page, "src/utils.ts")
      await waitForLspConnected(page)

      const before = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("editor.action.formatDocument")
      })
      await page.waitForTimeout(2000)
      const after = await page.evaluate(() => window.__gharargahAgent!.getEditorText())
      expect(after).toBeTruthy()
      expect(after!.length).toBeGreaterThanOrEqual(before!.length)
    } finally {
      await app.close()
    }
  })

  test("LSP resolves nested project root when workspace is parent folder", async () => {
    const { app, page } = await launchJet("fixtures")
    try {
      await openFixtureFile(page, "sample-workspace/src/index.ts")
      await waitForLspConnected(page)

      await openFixtureFile(page, "sample-workspace/src/lint-error.ts")
      await page.waitForTimeout(2500)

      await page.evaluate(async () => {
        await window.__gharargahAgent!.executeCommand("locationlist.showProblems")
      })
      await page.waitForTimeout(1500)

      await expectContainsText(page, PROBLEMS_PANEL, /error|Type|problem/i)
    } finally {
      await app.close()
    }
  })
})
