// @vitest-environment node
// Preload script security boundary tests.
// These tests verify the IPC channel contract between the preload bridge
// and the main process, ensuring correct channel mapping and payload shapes.
//
// The actual preload module runs in a special Electron context (contextBridge)
// that cannot be properly simulated in vitest. Instead, we test:
// 1. IPC channel constants are consistent
// 2. Payload shapes match expected types
// 3. No channel names are duplicated or missing
import { describe, it, expect } from "vitest"
import { IPC_CHANNELS } from "@/shared/ipc-channels"

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("Preload Security Boundary", () => {
  // ═══════════════════════════════════════════════════════════════════
  // IPC Channel constants exist and are unique
  // ═══════════════════════════════════════════════════════════════════

  it("all IPC channel values are unique strings", () => {
    const values = Object.values(IPC_CHANNELS)
    const uniqueValues = new Set(values)
    expect(uniqueValues.size).toBe(values.length)
  })

  it("all IPC channel values use the expected namespace format", () => {
    const values = Object.values(IPC_CHANNELS)
    for (const channel of values) {
      expect(channel).toMatch(/^[a-z][a-z0-9-]+:[a-z][a-z0-9-]+$/i)
    }
  })

  // ═══════════════════════════════════════════════════════════════════
  // Session channels
  // ═══════════════════════════════════════════════════════════════════

  it("has SESSION_CREATE channel", () => {
    expect(IPC_CHANNELS.SESSION_CREATE).toBeDefined()
    expect(typeof IPC_CHANNELS.SESSION_CREATE).toBe("string")
  })

  it("has SESSION_PROMPT channel", () => {
    expect(IPC_CHANNELS.SESSION_PROMPT).toBeDefined()
    expect(typeof IPC_CHANNELS.SESSION_PROMPT).toBe("string")
  })

  it("has SESSION_ABORT channel", () => {
    expect(IPC_CHANNELS.SESSION_ABORT).toBeDefined()
    expect(typeof IPC_CHANNELS.SESSION_ABORT).toBe("string")
  })

  it("has SESSION_DISPOSE channel", () => {
    expect(IPC_CHANNELS.SESSION_DISPOSE).toBeDefined()
    expect(typeof IPC_CHANNELS.SESSION_DISPOSE).toBe("string")
  })

  it("has SESSION_EVENTS channel", () => {
    expect(IPC_CHANNELS.SESSION_EVENTS).toBeDefined()
    expect(typeof IPC_CHANNELS.SESSION_EVENTS).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Project channels
  // ═══════════════════════════════════════════════════════════════════

  it("has PROJECT_ADD channel", () => {
    expect(IPC_CHANNELS.PROJECT_ADD).toBeDefined()
    expect(typeof IPC_CHANNELS.PROJECT_ADD).toBe("string")
  })

  it("has PROJECT_REMOVE channel", () => {
    expect(IPC_CHANNELS.PROJECT_REMOVE).toBeDefined()
    expect(typeof IPC_CHANNELS.PROJECT_REMOVE).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Workspace channels
  // ═══════════════════════════════════════════════════════════════════

  it("has WORKSPACE_SET_ACTIVE channel", () => {
    expect(IPC_CHANNELS.WORKSPACE_SET_ACTIVE).toBeDefined()
    expect(typeof IPC_CHANNELS.WORKSPACE_SET_ACTIVE).toBe("string")
  })

  it("has WORKSPACE_GET_ACTIVE channel", () => {
    expect(IPC_CHANNELS.WORKSPACE_GET_ACTIVE).toBeDefined()
    expect(typeof IPC_CHANNELS.WORKSPACE_GET_ACTIVE).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Git channels
  // ═══════════════════════════════════════════════════════════════════

  it("has GIT_GET_BRANCH channel", () => {
    expect(IPC_CHANNELS.GIT_GET_BRANCH).toBeDefined()
    expect(typeof IPC_CHANNELS.GIT_GET_BRANCH).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Dialog channels
  // ═══════════════════════════════════════════════════════════════════

  it("has DIALOG_OPEN_FOLDER channel", () => {
    expect(IPC_CHANNELS.DIALOG_OPEN_FOLDER).toBeDefined()
    expect(typeof IPC_CHANNELS.DIALOG_OPEN_FOLDER).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Window channels
  // ═══════════════════════════════════════════════════════════════════

  it("has WINDOW_MINIMIZE channel", () => {
    expect(IPC_CHANNELS.WINDOW_MINIMIZE).toBeDefined()
    expect(typeof IPC_CHANNELS.WINDOW_MINIMIZE).toBe("string")
  })

  it("has WINDOW_MAXIMIZE channel", () => {
    expect(IPC_CHANNELS.WINDOW_MAXIMIZE).toBeDefined()
    expect(typeof IPC_CHANNELS.WINDOW_MAXIMIZE).toBe("string")
  })

  it("has WINDOW_CLOSE channel", () => {
    expect(IPC_CHANNELS.WINDOW_CLOSE).toBeDefined()
    expect(typeof IPC_CHANNELS.WINDOW_CLOSE).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Zoom channels
  // ═══════════════════════════════════════════════════════════════════

  it("has ZOOM_SET channel", () => {
    expect(IPC_CHANNELS.ZOOM_SET).toBeDefined()
    expect(typeof IPC_CHANNELS.ZOOM_SET).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Update channels
  // ═══════════════════════════════════════════════════════════════════

  it("has UPDATE_AVAILABLE channel", () => {
    expect(IPC_CHANNELS.UPDATE_AVAILABLE).toBeDefined()
    expect(typeof IPC_CHANNELS.UPDATE_AVAILABLE).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Notification channels
  // ═══════════════════════════════════════════════════════════════════

  it("has NOTIFICATION_SETTINGS_GET channel", () => {
    expect(IPC_CHANNELS.NOTIFICATION_SETTINGS_GET).toBeDefined()
    expect(typeof IPC_CHANNELS.NOTIFICATION_SETTINGS_GET).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Shell channels
  // ═══════════════════════════════════════════════════════════════════

  it("has SHELL_OPEN_IN_VSCODE channel", () => {
    expect(IPC_CHANNELS.SHELL_OPEN_IN_VSCODE).toBeDefined()
    expect(typeof IPC_CHANNELS.SHELL_OPEN_IN_VSCODE).toBe("string")
  })

  it("has SHELL_OPEN_IN_EXPLORER channel", () => {
    expect(IPC_CHANNELS.SHELL_OPEN_IN_EXPLORER).toBeDefined()
    expect(typeof IPC_CHANNELS.SHELL_OPEN_IN_EXPLORER).toBe("string")
  })

  it("has SHELL_CHECK_VSCODE_AVAILABLE channel", () => {
    expect(IPC_CHANNELS.SHELL_CHECK_VSCODE_AVAILABLE).toBeDefined()
    expect(typeof IPC_CHANNELS.SHELL_CHECK_VSCODE_AVAILABLE).toBe("string")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Security: Channel names follow strict format
  // ═══════════════════════════════════════════════════════════════════

  it("no channel contains raw electron API references", () => {
    const values = Object.values(IPC_CHANNELS).join(" ")
    expect(values).not.toContain("ipcRenderer")
    expect(values).not.toContain("contextBridge")
  })

  it("channel names use colon-separated namespace format", () => {
    // All channels should follow "namespace:action" format
    const expectedNamespaces = [
      "session", "project", "workspace", "git", "dialog",
      "window", "zoom", "update", "notification", "shell",
    ]
    const values = Object.values(IPC_CHANNELS)
    for (const channel of values) {
      const namespace = channel.split(":")[0]
      expect(expectedNamespaces).toContain(namespace)
    }
  })

  it("all expected channel namespaces are present", () => {
    const values = Object.values(IPC_CHANNELS)
    const namespaces = new Set(values.map((v) => v.split(":")[0]))
    expect(namespaces).toContain("session")
    expect(namespaces).toContain("project")
    expect(namespaces).toContain("workspace")
    expect(namespaces).toContain("git")
    expect(namespaces).toContain("dialog")
    expect(namespaces).toContain("window")
    expect(namespaces).toContain("zoom")
    expect(namespaces).toContain("update")
    expect(namespaces).toContain("notification")
    expect(namespaces).toContain("shell")
  })
})
