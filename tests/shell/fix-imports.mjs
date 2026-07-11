#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const specDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron")
for (const file of fs.readdirSync(specDir).filter(f => f.endsWith(".electron.spec.ts"))) {
  let src = fs.readFileSync(path.join(specDir, file), "utf8")
  src = src.replace(/,\n,\n  expectLocatorContainsText,\n  expectNotContainsText\}/g, ",\n  expectLocatorContainsText,\n  expectNotContainsText,\n}")
  src = src.replace(
    /import \{ expectLocatorContainsText, expectNotContainsText \} from "\.\.\/shell\/assert\.js"\n/g,
    "",
  )
  fs.writeFileSync(path.join(specDir, file), src)
  console.log("fixed", file)
}
