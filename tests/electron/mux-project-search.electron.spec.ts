import { expect, test } from "@playwright/test"
import { expectListRows } from "../helpers/list.js"
import {
  expectLocatorContainsText,
  expectLocatorVisible,
} from "../shell/assert.js"
import { execCommand, launchJet, waitForMux } from "./_launch.js"

test.describe("mux project search", () => {
  test("cancels, previews, applies open-buffer replace, and undoes", async () => {
    const { app, page } = await launchJet({ withTerminal: false })
    try {
      await waitForMux(page)
      await page.evaluate(() => window.__yaadeAgent!.openFile("src/utils.ts"))
      await page.evaluate(() => window.__yaadeAgent!.waitForEditor())
      const buffer = () => page.evaluate(() =>
        window.__yaadeAgent!.getEditorDiagnostics().models.entries.find(entry =>
          entry.uri.endsWith("/src/utils.ts"),
        ) ?? null,
      )
      await expect.poll(async () => (await buffer())?.content ?? null).toContain("Hello")

      await execCommand(page, "editor.projectSearch")
      const palette = page.locator("[data-yaade-palette]")
      await expectLocatorVisible(palette)
      await palette.locator("input").first().fill("Hello")
      await page.evaluate(() => window.__yaadeAgent!.waitForListRows("yaade:palette", 1))
      await expectListRows(page, {
        panel: "yaade:palette",
        minItems: 1,
        needle: "src/utils.ts:2",
        noResultsText: "No matches.",
      })

      await page.getByLabel("Replace with").fill("Hi")
      await page.getByRole("button", { name: "Preview 1", exact: true }).click()
      await expectLocatorContainsText(palette, "Preview: 1 edits in 1 files.")
      await page.getByRole("button", { name: "Apply", exact: true }).click()

      await expect.poll(async () => (await buffer())?.content ?? null).toContain("Hi, ${name}")
      expect((await buffer())?.dirty).toBe(true)
      expect(
        await page.evaluate(() => window.__yaadeAgent!.readFixtureFile("src/utils.ts")),
        "replace must not auto-save an open buffer",
      ).toContain("Hello, ${name}")

      await page.getByRole("button", { name: "Undo replace", exact: true }).click()
      await expect.poll(async () => (await buffer())?.content ?? null).toContain("Hello, ${name}")
      await expect.poll(async () => (await buffer())?.dirty ?? null).toBe(false)
    } finally {
      await app.close()
    }
  })
})
