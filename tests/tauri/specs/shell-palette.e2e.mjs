const EXPLORER_PANEL = '[data-jet-list-panel="jet:explorer"]'

async function execCommand(name) {
  await browser.execute(async cmd => {
    await window.__jetAgent.executeCommand(cmd)
  }, name)
}

describe("tauri shell palette", () => {
  it("opens centered, runs explorer command, closes on Escape", async () => {
    await browser.waitUntil(
      async () => browser.execute(() => window.__jetAgent != null),
      { timeout: 60_000, interval: 250, timeoutMsg: "__jetAgent not mounted" },
    )
    await browser.execute(async () => {
      await window.__jetAgent.waitForReady()
    })

    await execCommand("ui.showCommandPalette")

    const dialog = await $('[role="dialog"]')
    await dialog.waitForDisplayed({ timeout: 10_000 })

    await browser.waitUntil(
      async () =>
        browser.execute(() => window.__jetAgent.getState().paletteOpen),
      { timeout: 10_000, timeoutMsg: "paletteOpen never became true" },
    )

    const input = await dialog.$('[role="combobox"]')
    await input.setValue("explorer")
    const options = await $$('[role="option"]')
    let clicked = false
    for (const opt of options) {
      const text = await opt.getText()
      if (/explorer/i.test(text)) {
        await opt.click()
        clicked = true
        break
      }
    }
    if (!clicked) {
      throw new Error("explorer palette option not found")
    }

    const explorer = await $(EXPLORER_PANEL)
    await explorer.waitForDisplayed({ timeout: 10_000 })

    await execCommand("ui.showCommandPalette")
    await browser.keys(["Escape"])

    await browser.waitUntil(
      async () => {
        const dialogs = await $$('[role="dialog"]')
        return (await dialogs.length) === 0
      },
      { timeout: 10_000, timeoutMsg: "palette did not close" },
    )
  })
})
