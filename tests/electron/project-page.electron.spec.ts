import { expect, test } from "@playwright/test"
import { expectListRows } from "../helpers/list.js"
import { launchJet, waitForProjectPage } from "./_launch.js"

test.describe("project page", () => {
  test("lists sessions with scoped anti-tautology assertions", async () => {
    const { app, page } = await launchJet({ projectPage: true })
    try {
      await waitForProjectPage(page)

      await page.evaluate(async () => {
        await window.__yaadeAgent!.createProjectSession?.({
          title: "E2E Session Alpha",
        })
        await window.__yaadeAgent!.backToProject?.()
      })
      await waitForProjectPage(page)

      await expectListRows(page, {
        panel: "project-sessions",
        minItems: 1,
        needle: "E2E Session Alpha",
        noResultsText: "No matching sessions",
      })
    } finally {
      await app.close()
    }
  })
})
