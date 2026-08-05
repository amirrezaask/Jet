import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { defaultHostLaunchPath, launchPathFromArgv } from "./launch-path.mjs"

describe("electron launch path", () => {
  const packageDir = "/Users/me/dev/yaade/apps/yaade-electron"

  it("ignores packaged asar / Resources app paths", () => {
    assert.equal(
      launchPathFromArgv(
        ["YAADE", "/Applications/YAADE.app/Contents/Resources/app.asar"],
        { packageDir },
      ),
      undefined,
    )
    assert.equal(
      launchPathFromArgv(
        ["YAADE", "/Applications/YAADE.app/Contents/Resources/app"],
        { packageDir },
      ),
      undefined,
    )
  })

  it("accepts an explicit user folder", () => {
    const folder = path.join(os.homedir(), "Projects", "demo")
    assert.equal(
      launchPathFromArgv(["electron", packageDir, "--dev", folder], { packageDir }),
      path.resolve(folder),
    )
  })

  it("defaults packaged host launch to home", () => {
    assert.equal(
      defaultHostLaunchPath("/Applications/YAADE.app/Contents/Resources/yaade"),
      os.homedir(),
    )
    assert.equal(defaultHostLaunchPath(undefined), undefined)
  })
})
