import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { AuthStorageBackend } from "@earendil-works/pi-coding-agent"
import type { Credential } from "@earendil-works/pi-ai"

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8").slice("encrypted:".length),
  },
}))

import { createEncryptedAuthStorage, createSecureAuthStorage } from "@/main/secure-key-store"

function memoryBackend(initial: Credential): AuthStorageBackend {
  let value = JSON.stringify({ provider: initial })
  return {
    withLock(fn) {
      const result = fn(value)
      if (result.next !== undefined) value = result.next
      return result.result
    },
    async withLockAsync(fn) {
      const result = await fn(value)
      if (result.next !== undefined) value = result.next
      return result.result
    },
  }
}

function readRawCredential(backend: AuthStorageBackend): Credential | undefined {
  return backend.withLock((current) => ({ result: current ? JSON.parse(current).provider : undefined }))
}

describe("secure credential storage", () => {
  it("preserves the new SDK OAuth credential fields through the encrypted adapter", async () => {
    const inner = memoryBackend({ type: "oauth", access: "access-token", refresh: "refresh-token", expires: 123 })
    const store = createEncryptedAuthStorage(inner)

    store.withLock((current) => {
      const data = current ? JSON.parse(current) : {}
      expect(data.provider).toEqual({ type: "oauth", access: "access-token", refresh: "refresh-token", expires: 123 })
      data.provider.access = "next-access"
      data.provider.refresh = "next-refresh"
      return { result: undefined, next: JSON.stringify(data) }
    })

    const stored = readRawCredential(inner)
    if (stored?.type !== "oauth") throw new Error("Expected OAuth credential")
    expect(stored.access).toMatch(/^enc:v1:/)
    expect(stored.refresh).toMatch(/^enc:v1:/)
    const decrypted = store.withLock((current) => ({ result: current ? JSON.parse(current) : {} }))
    expect(decrypted.provider).toEqual({ type: "oauth", access: "next-access", refresh: "next-refresh", expires: 123 })
  })

  it("round-trips API key credentials without changing provider environment values", async () => {
    const inner = memoryBackend({ type: "api_key", key: "api-key", env: { ACCOUNT_ID: "account" } })
    const store = createEncryptedAuthStorage(inner)

    store.withLock((current) => ({ result: undefined, next: current }))
    const raw = readRawCredential(inner)
    expect(raw?.key).toMatch(/^enc:v1:/)
  })

  it("persists encrypted credentials and supports modify/delete through the file store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nekocode-secure-store-"))
    try {
      const store = await createSecureAuthStorage(join(directory, "auth.json"))
      await store.modify("provider", async () => ({ type: "api_key", key: "file-key" }))

      const raw = await readFile(join(directory, "auth.json"), "utf8")
      expect(raw).toContain("enc:v1:")
      expect(await store.read("provider")).toEqual({ type: "api_key", key: "file-key" })

      // Command-backed keys must remain in their config form on disk so the
      // SDK can resolve them when read, instead of being eagerly executed.
      await store.modify("command", async () => ({ type: "api_key", key: "!printf command-key" }))
      expect(await store.read("command")).toEqual({ type: "api_key", key: "command-key" })

      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          store.modify(`concurrent-${index}`, async () => ({ type: "api_key", key: `key-${index}` })),
        ),
      )
      expect((await store.list()).length).toBe(10)

      await store.delete("provider")
      expect(await store.read("provider")).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
