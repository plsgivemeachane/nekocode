import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { afterEach, describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const { copySdkStaticAssets, getPinnedSdkVersion } = require("../../../scripts/build-worker.cjs") as {
  copySdkStaticAssets: (targetDir: string, sdkPkgDir: string) => { packageDir: string; copied: number }
  getPinnedSdkVersion: () => string
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function makeSdkFixture(metadata: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "nekocode-build-worker-"))
  temporaryDirectories.push(root)
  await mkdir(join(root, "docs"), { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify(metadata))
  await writeFile(join(root, "README.md"), "fixture")
  await writeFile(join(root, "docs", "index.md"), "fixture docs")
  return root
}

describe("build-worker SDK asset copying", () => {
  it("uses the pinned earendil SDK and copies matching package metadata", async () => {
    const sdkPackage = await makeSdkFixture({
      name: "@earendil-works/pi-coding-agent",
      version: getPinnedSdkVersion(),
    })
    const output = await mkdtemp(join(tmpdir(), "nekocode-worker-output-"))
    temporaryDirectories.push(output)

    const result = copySdkStaticAssets(output, sdkPackage)
    expect(result.copied).toBe(3)
    expect(JSON.parse(await readFile(join(result.packageDir, "package.json"), "utf8"))).toEqual({
      name: "@earendil-works/pi-coding-agent",
      version: getPinnedSdkVersion(),
    })
    expect(await readFile(join(result.packageDir, "docs", "index.md"), "utf8")).toBe("fixture docs")
  })

  it("fails when the installed SDK metadata does not match the pinned package", async () => {
    const sdkPackage = await makeSdkFixture({
      name: "@mariozechner/pi-coding-agent",
      version: "0.75.3",
    })
    const output = await mkdtemp(join(tmpdir(), "nekocode-worker-output-"))
    temporaryDirectories.push(output)

    expect(() => copySdkStaticAssets(output, sdkPackage)).toThrow(/SDK package metadata mismatch/)
  })
})
