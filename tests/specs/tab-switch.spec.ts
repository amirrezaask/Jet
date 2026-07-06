import { test, expect } from "@playwright/test"
import { boot, SAMPLE, waitAnimationsIdle } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"
import { focusEditor } from "../helpers/editor.js"
import {
  INDEX_MAIN,
  PACKAGE_NAME,
  UTILS_GREET,
  clickTab,
  expectActiveTabSuffix,
  expectEditorAndTabInSync,
  expectEditorBuffer,
  expectSingleEditorMounted,
  switchTabExpectBuffer,
  tabBarTrigger,
  selectBufferFromList,
  expectMinOpenBuffers,
} from "../helpers/tabs.js"

test.beforeEach(async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await waitAnimationsIdle(page)
})

test("tab-switch: tab bar click updates active slot and editor text", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await expectEditorBuffer(page, { contains: UTILS_GREET, notContains: INDEX_MAIN })

  await switchTabExpectBuffer(page, "src/index.ts", {
    contains: INDEX_MAIN,
    notContains: UTILS_GREET,
  })
  await switchTabExpectBuffer(page, "src/utils.ts", {
    contains: UTILS_GREET,
    notContains: INDEX_MAIN,
  })
})

test("tab-switch: rapid tab bar clicks end on correct buffer", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await agent(page).openFile("package.json")
  await expectEditorBuffer(page, { contains: PACKAGE_NAME })

  // Flip quickly — regression for async attach leaving stale CM content visible.
  for (let i = 0; i < 4; i++) {
    await clickTab(page, "src/index.ts")
    await clickTab(page, "src/utils.ts")
    await clickTab(page, "package.json")
  }

  await expectActiveTabSuffix(page, "package.json")
  await expectEditorBuffer(page, { contains: PACKAGE_NAME, notContains: INDEX_MAIN })
  await expectSingleEditorMounted(page)
})

test("tab-switch: buffer list switches content and active tab", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await expectEditorBuffer(page, { contains: UTILS_GREET })
  await expectMinOpenBuffers(page, 2)

  await selectBufferFromList(page, "index.ts")

  await expectActiveTabSuffix(page, "src/index.ts")
  await expectEditorBuffer(page, { contains: INDEX_MAIN, notContains: UTILS_GREET })
})

test("tab-switch: previous/next buffer commands sync tab bar and editor", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts", extraFiles: ["src/utils.ts"] })
  await waitAnimationsIdle(page)
  await expectEditorBuffer(page, { contains: UTILS_GREET })

  await agent(page).executeCommand("editor.previousEditor")
  await page.waitForTimeout(200)
  await expectEditorAndTabInSync(page, "src/index.ts", {
    contains: INDEX_MAIN,
    notContains: UTILS_GREET,
  })

  await agent(page).executeCommand("editor.nextEditor")
  await page.waitForTimeout(200)
  await expectEditorAndTabInSync(page, "src/utils.ts", {
    contains: UTILS_GREET,
    notContains: INDEX_MAIN,
  })
})

test("tab-switch: re-opening file via agent activates tab with correct content", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await switchTabExpectBuffer(page, "src/index.ts", {
    contains: INDEX_MAIN,
    notContains: UTILS_GREET,
  })

  await agent(page).openFile("src/utils.ts")
  await expectActiveTabSuffix(page, "src/utils.ts")
  await expectEditorBuffer(page, { contains: UTILS_GREET, notContains: INDEX_MAIN })
})

test("tab-switch: only one CodeMirror instance after multi-tab workflow", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await agent(page).openFile("package.json")
  await switchTabExpectBuffer(page, "src/index.ts", { contains: INDEX_MAIN })
  await switchTabExpectBuffer(page, "src/utils.ts", { contains: UTILS_GREET })
  await expectSingleEditorMounted(page)
})

test("tab-switch: edits survive tab round-trip", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await focusEditor(page)
  const marker = ` tab-switch-marker-${Date.now()}`
  await page.keyboard.type(marker)

  await switchTabExpectBuffer(page, "src/index.ts", { contains: INDEX_MAIN })
  await switchTabExpectBuffer(page, "src/utils.ts", { contains: marker })

  const text = await agent(page).getEditorText()
  expect(text).toContain(marker)
})

test("tab-switch: tab bar shows both tabs while active slot tracks selection", async ({ page }) => {
  await agent(page).openFile("src/utils.ts")
  await expect(tabBarTrigger(page, "src/index.ts")).toBeVisible()
  await expect(tabBarTrigger(page, "src/utils.ts")).toBeVisible()
  await expect(tabBarTrigger(page, "src/utils.ts")).toHaveAttribute("data-state", "active")

  await clickTab(page, "src/index.ts")
  await expect(tabBarTrigger(page, "src/index.ts")).toHaveAttribute("data-state", "active")
  await expect(tabBarTrigger(page, "src/utils.ts")).toHaveAttribute("data-state", "inactive")
})
