import { expect, test } from "@playwright/test"
import { launchJet } from "./_launch.js"

test.describe("host filesystem mutations and YAADE trash", () => {
  test("creates, renames, trashes, restores-as, empties, and enforces roots", async () => {
    const { app, page } = await launchJet({
      projectPage: true,
      expectedHttpErrors: [
        { method: "POST", path: "/api/v1/rpc", status: 403 },
        { method: "POST", path: "/api/v1/rpc", status: 409 },
      ],
    })
    try {
      const result = await page.evaluate(async () => {
        const fsApi = window.yaade!.fs
        const workspacePath = window.__yaadeAgent!.listWorkspaces()[0]!.path
        const asUri = (relative: string) =>
          encodeURI(`file://${workspacePath}/${relative}`)

        const directoryUri = asUri("fs-mutations")
        const sourceUri = asUri("fs-mutations/source.txt")
        const renamedUri = asUri("fs-mutations/renamed.txt")
        const alternateUri = asUri("fs-mutations/restored-as.txt")
        await fsApi.mkdir(directoryUri)
        await fsApi.createFile(sourceUri)
        await fsApi.writeFile(sourceUri, "host-trash-roundtrip")
        const renamed = await fsApi.rename(sourceUri, renamedUri)
        const trashed = await fsApi.trash(renamedUri)

        await fsApi.createFile(renamedUri)
        let restoreConflict: { code?: string } = {}
        try {
          await fsApi.restoreTrash(trashed.id)
        } catch (error) {
          if (typeof error === "object" && error !== null) {
            restoreConflict = {
              code:
                "code" in error && typeof error.code === "string"
                  ? error.code
                  : undefined,
            }
          }
        }
        const stillTrashed = await fsApi.listTrash()
        const restored = await fsApi.restoreTrash(trashed.id, alternateUri)
        const restoredContent = await fsApi.readFile(alternateUri)

        const emptyCandidate = await fsApi.trash(alternateUri)
        const emptied = await fsApi.emptyTrash()
        const afterEmpty = await fsApi.listTrash()

        const protectedUri = asUri("fs-mutations/protected.txt")
        await fsApi.createFile(protectedUri)
        const outsideResponse = await fetch("/api/v1/rpc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channel: "fs:rename",
            args: [protectedUri, "file:///etc/yaade-must-not-write.txt"],
          }),
        })
        const outsideBody = await outsideResponse.json()

        return {
          renamed,
          trashed,
          restoreConflict,
          stillTrashed: stillTrashed.map(entry => entry.id),
          restored,
          restoredContent,
          emptyCandidateId: emptyCandidate.id,
          emptied,
          afterEmpty,
          outsideStatus: outsideResponse.status,
          outsideCode: outsideBody.error?.code,
          protectedStillExists: await fsApi.exists(protectedUri),
        }
      })

      expect(result.renamed.uri).toContain("/fs-mutations/renamed.txt")
      expect(result.trashed.name).toBe("renamed.txt")
      expect(result.restoreConflict).toEqual({ code: "CONFLICT" })
      expect(result.stillTrashed).toEqual([result.trashed.id])
      expect(result.restored.uri).toContain("/fs-mutations/restored-as.txt")
      expect(result.restoredContent).toBe("host-trash-roundtrip")
      expect(result.emptied).toEqual({ removed: 1, bytes: 20 })
      expect(result.afterEmpty).toEqual([])
      expect(result.emptyCandidateId).toBeTruthy()
      expect(result.outsideStatus).toBe(403)
      expect(result.outsideCode).toBe("PATH_OUTSIDE_ALLOWED_ROOTS")
      expect(result.protectedStillExists).toBe(true)
    } finally {
      await app.close()
    }
  })
})
