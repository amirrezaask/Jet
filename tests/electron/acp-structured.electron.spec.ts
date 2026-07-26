import { expect, test } from "@playwright/test"
import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet } from "./_launch.js"

const agentChatE2e = process.env.GHARARGAH_ENABLE_AGENT_CHAT !== "0"

async function openCursorAcpSession(page: Awaited<ReturnType<typeof launchJet>>["page"]) {
  await page.evaluate(() => window.gharargah!.agents!.listAgents())
  await page.getByRole("button", { name: "New session" }).first().click()
  await page.locator('[data-gharargah-agent-shortcut="cursor"]').click()
  const modal = page.locator("[data-gharargah-terminal-modal]")
  await expectLocatorVisible(modal)
  await expect.poll(() => modal.getAttribute("data-gharargah-session-mode")).toBe("agent")
  const composer = modal.locator('[data-testid="composer-editor"]')
  await expectLocatorVisible(composer, { timeout: 20_000 })
  await expectLocatorVisible(modal.locator("[data-composer-attach-image]"))
  return { modal, composer }
}

async function readActiveThread(page: Awaited<ReturnType<typeof launchJet>>["page"]) {
  const path = await page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace!)
  const uri = `file://${path}`
  return page.evaluate(
    async ({ uri, path }) => {
      const agents = window.gharargah!.agents!
      const list = await agents.listThreads(uri, path)
      const id = list.threads[0]?.id
      if (!id) return null
      return agents.readThread(uri, path, id)
    },
    { uri, path },
  )
}

test.describe("ACP structured timeline", () => {
  test.skip(!hasPtySpawn(), "node-pty cannot spawn a shell on this machine")
  test.skip(
    !agentChatE2e,
    "disabled in GHARARGAH_ENABLE_AGENT_CHAT=0 recovery builds",
  )

  test("mock ACP streams a simple reply", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const { modal, composer } = await openCursorAcpSession(page)
      await composer.click()
      await composer.fill("ACP structured smoke")
      await modal.getByRole("button", { name: "Send message" }).click()

      await expect
        .poll(
          async () => {
            const thread = await readActiveThread(page)
            const assistant = [...(thread?.messages ?? [])]
              .reverse()
              .find(message => message.role === "assistant")
            return `${thread?.status ?? "missing"}::${assistant?.text ?? ""}`
          },
          { timeout: 30_000 },
        )
        .toContain("Mock agent reply: ACP structured smoke")

      await expect
        .poll(() => modal.textContent(), { timeout: 10_000 })
        .toContain("Mock agent reply: ACP structured smoke")
    } finally {
      await app.close()
    }
  })

  test("dropping a file anywhere in the Agent tab attaches it to the composer", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      const { modal, composer } = await openCursorAcpSession(page)
      const dropped = await page.evaluate(() => {
        const target = document.querySelector("[data-messages-timeline]")
        if (!target) return false
        const file = new File(
          ["drag-drop-context-marker-42\n"],
          "agent-context.md",
          { type: "text/markdown" },
        )
        const transfer = new DataTransfer()
        transfer.items.add(file)
        const event = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        })
        return target.dispatchEvent(event)
      })
      expect(dropped).toBe(false)

      const attachments = modal.locator("[data-composer-attachments]")
      await expectLocatorVisible(attachments)
      await expect
        .poll(() => attachments.getAttribute("data-composer-attachment-count"))
        .toBe("1")
      await expectLocatorContainsText(attachments, "agent-context.md")

      await composer.fill("Review the attached file")
      await modal.getByRole("button", { name: "Send message" }).click()
      await expect
        .poll(
          async () => {
            const thread = await readActiveThread(page)
            const assistant = [...(thread?.messages ?? [])]
              .reverse()
              .find(message => message.role === "assistant")
            return assistant?.text ?? ""
          },
          { timeout: 30_000 },
        )
        .toContain("drag-drop-context-marker-42")
      await expectLocatorCount(modal.locator('[data-message-attachment="file"]'), 1)
    } finally {
      await app.close()
    }
  })

  test("permission_allow resolves through the permission card", async () => {
    const { app, page } = await launchJet({
      env: {
        GHARARGAH_AGENT_MOCK: "1",
        GHARARGAH_AGENT_MOCK_SCENARIO: "permission_allow",
      },
    })
    try {
      const { modal, composer } = await openCursorAcpSession(page)
      await composer.click()
      await composer.fill("need permission")
      await modal.getByRole("button", { name: "Send message" }).click()

      await expect
        .poll(async () => (await readActiveThread(page))?.pendingPermissions?.length ?? 0, {
          timeout: 30_000,
        })
        .toBeGreaterThan(0)

      // Prefer sticky composer card; labels may be "Allow" or "Allow once".
      const allow = modal.getByRole("button", { name: /Allow/i }).last()
      await expectLocatorVisible(allow, { timeout: 15_000 })
      await allow.click()

      await expect
        .poll(
          async () => {
            const thread = await readActiveThread(page)
            const assistant = [...(thread?.messages ?? [])]
              .reverse()
              .find(message => message.role === "assistant")
            return assistant?.text ?? ""
          },
          { timeout: 30_000 },
        )
        .toContain("Mock agent reply")

      await expect
        .poll(async () => {
          const thread = await readActiveThread(page)
          return thread?.pendingPermissions?.length ?? -1
        })
        .toBe(0)
    } finally {
      await app.close()
    }
  })

  test("thought_then_answer shows thought then reply", async () => {
    const { app, page } = await launchJet({
      env: {
        GHARARGAH_AGENT_MOCK: "1",
        GHARARGAH_AGENT_MOCK_SCENARIO: "thought_then_answer",
      },
    })
    try {
      const { modal, composer } = await openCursorAcpSession(page)
      await composer.click()
      await composer.fill("think then answer")
      await modal.getByRole("button", { name: "Send message" }).click()

      await expect
        .poll(
          async () => {
            const thread = await readActiveThread(page)
            const thought = (thread?.timeline ?? []).find(item => item.kind === "thought")
            if (thought && "text" in thought) return thought.text
            return thread?.activity ?? ""
          },
          { timeout: 30_000 },
        )
        .toMatch(/Mock thought|Thinking/)

      // Timeline ThoughtBlock may be virtualized; data attr is best-effort UI signal.
      const thoughtNode = modal.locator("[data-gharargah-thought]").first()
      if ((await thoughtNode.count()) > 0) {
        await expect
          .poll(async () => (await thoughtNode.getAttribute("data-gharargah-thought-text")) ?? "")
          .toContain("Mock thought")
      }

      await expect
        .poll(
          async () => {
            const thread = await readActiveThread(page)
            const assistant = [...(thread?.messages ?? [])]
              .reverse()
              .find(message => message.role === "assistant")
            return assistant?.text ?? ""
          },
          { timeout: 30_000 },
        )
        .toContain("Mock agent reply: think then answer")

      const visibleReplies = modal
        .locator('[data-timeline-row-kind="message"]')
        .filter({ hasText: "Mock agent reply: think then answer" })
      await expect
        .poll(() => visibleReplies.count(), { timeout: 10_000 })
        .toBe(1)
    } finally {
      await app.close()
    }
  })

  test("tool_lifecycle plan_update usage_meter expose structured UI", async () => {
    for (const scenario of ["tool_lifecycle", "plan_update", "usage_meter"] as const) {
      const { app, page } = await launchJet({
        env: {
          GHARARGAH_AGENT_MOCK: "1",
          GHARARGAH_AGENT_MOCK_SCENARIO: scenario,
        },
      })
      try {
        const { modal, composer } = await openCursorAcpSession(page)
        await composer.click()
        await composer.fill(`scenario ${scenario}`)
        await modal.getByRole("button", { name: "Send message" }).click()

        await expect
          .poll(
            async () => {
              const thread = await readActiveThread(page)
              const kinds = (thread?.timeline ?? []).map(item => item.kind)
              if (scenario === "tool_lifecycle") return kinds.includes("tool_call") ? "ok" : kinds.join(",")
              if (scenario === "plan_update") {
                return kinds.includes("plan") || thread?.plan ? "ok" : kinds.join(",")
              }
              return kinds.includes("usage") || thread?.usage ? "ok" : kinds.join(",")
            },
            { timeout: 30_000 },
          )
          .toBe("ok")

        // DOM markers (virtualized list may need a beat after thread JSON updates).
        if (scenario === "tool_lifecycle") {
          await expect
            .poll(async () => modal.locator("[data-gharargah-tool-call], [data-timeline-tool]").count(), {
              timeout: 15_000,
            })
            .toBeGreaterThan(0)
        }
        if (scenario === "plan_update") {
          await expect
            .poll(async () => modal.locator("[data-gharargah-plan]").count(), { timeout: 15_000 })
            .toBeGreaterThan(0)
        }
        if (scenario === "usage_meter") {
          await expect
            .poll(async () => modal.locator("[data-gharargah-usage]").count(), { timeout: 15_000 })
            .toBeGreaterThan(0)
        }
      } finally {
        await app.close()
      }
    }
  })
})
