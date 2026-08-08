import { expect, test } from "@playwright/test"
import { launchJet } from "./_launch.js"

test.describe("search host pipeline", () => {
  test("supports non-git Quick Open, match ranges, filters, and watcher refresh", async () => {
    const { app, page } = await launchJet({
      workspaceRel: "fixtures/non-git-search",
      withTerminal: false,
    })
    try {
      const initial = await page.evaluate(async () => {
        const workspacePath = window.__yaadeAgent!.listWorkspaces()[0]!.path
        const root = encodeURI(`file://${workspacePath}`)
        const search = window.yaade!.search
        return {
          root,
          supported: await search.isSupported!(root),
          files: await search.fileSearch(root, "index", { pageSize: 10 }),
          matches: await search.project(root, "export", {
            caseSensitive: true,
            wholeWord: true,
            include: ["src/**"],
            exclude: ["**/other.ts"],
          }),
        }
      })

      expect(initial.supported).toBe(true)
      expect(initial.files).toEqual({
        items: ["src/index.ts"],
        truncated: false,
      })
      expect(initial.matches.truncated).toBe(false)
      expect(initial.matches.items).toHaveLength(1)
      expect(initial.matches.items[0]?.path).toBe("src/index.ts")
      expect(initial.matches.items[0]?.ranges).toEqual([{
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 7,
      }])

      await page.evaluate(async root => {
        await window.yaade!.fs.writeFile(
          `${root}/src/watch-refresh.ts`,
          "export const watcherRefresh = true\n",
        )
      }, initial.root)

      await expect.poll(
        () => page.evaluate(async root =>
          window.yaade!.search.fileSearch(root, "watch-refresh", { pageSize: 10 }),
        initial.root),
        { timeout: 10_000 },
      ).toEqual({ items: ["src/watch-refresh.ts"], truncated: false })
    } finally {
      await app.close()
    }
  })
})
