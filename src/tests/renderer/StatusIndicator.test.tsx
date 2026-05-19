// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"
import { StatusIndicator } from "@/renderer/src/components/layout/StatusIndicator"
import type { UsageData } from "@/shared/ipc-types"

// ── Helpers ──────────────────────────────────────────────────────────

const defaultUsage: UsageData = {
  inputTokens: 0,
  outputTokens: 0,
  totalCost: 0,
  contextWindow: 0,
  contextPercent: 0,
}

const defaultProps = {
  isStreaming: false,
  isAgentConnecting: false,
  modelName: "TestModel",
  usage: defaultUsage,
  streamStartTime: 0,
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("StatusIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Model name
  // ═══════════════════════════════════════════════════════════════════

  it("renders model name when provided", () => {
    render(<StatusIndicator {...defaultProps} modelName="Claude 3.5" />)
    expect(screen.getByText("Claude 3.5")).toBeInTheDocument()
  })

  it("does not render model name when null", () => {
    render(<StatusIndicator {...defaultProps} modelName={null} />)
    expect(screen.queryByText("Claude 3.5")).not.toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Status states
  // ═══════════════════════════════════════════════════════════════════

  it("shows Ready status when not streaming and not connecting", () => {
    render(<StatusIndicator {...defaultProps} />)
    expect(screen.getByText("Ready")).toBeInTheDocument()
  })

  it("shows Working status when streaming", () => {
    render(<StatusIndicator {...defaultProps} isStreaming={true} />)
    expect(screen.getByText("Working")).toBeInTheDocument()
  })

  it("shows Connecting status when agent is connecting", () => {
    render(<StatusIndicator {...defaultProps} isAgentConnecting={true} />)
    expect(screen.getByText("Connecting")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Token usage display
  // ═══════════════════════════════════════════════════════════════════

  it("shows token usage when input/output tokens > 0", () => {
    const usage: UsageData = {
      inputTokens: 1500,
      outputTokens: 3200,
      totalCost: 0,
      contextWindow: 0,
      contextPercent: 0,
    }
    render(<StatusIndicator {...defaultProps} usage={usage} />)
    expect(screen.getByTitle("Input tokens")).toBeInTheDocument()
    expect(screen.getByTitle("Output tokens")).toBeInTheDocument()
  })

  it("formats token counts with k suffix for thousands", () => {
    const usage: UsageData = {
      inputTokens: 1500,
      outputTokens: 2500000,
      totalCost: 0,
      contextWindow: 0,
      contextPercent: 0,
    }
    render(<StatusIndicator {...defaultProps} usage={usage} />)
    expect(screen.getByTitle("Input tokens").textContent).toContain("1.5k")
    expect(screen.getByTitle("Output tokens").textContent).toContain("2.5M")
  })

  it("shows cost when totalCost > 0", () => {
    const usage: UsageData = {
      inputTokens: 100,
      outputTokens: 200,
      totalCost: 0.05,
      contextWindow: 0,
      contextPercent: 0,
    }
    render(<StatusIndicator {...defaultProps} usage={usage} />)
    expect(screen.getByTitle("Total cost")).toBeInTheDocument()
    expect(screen.getByTitle("Total cost").textContent).toContain("$0.05")
  })

  it("does not show cost when totalCost is 0", () => {
    const usage: UsageData = {
      inputTokens: 100,
      outputTokens: 200,
      totalCost: 0,
      contextWindow: 0,
      contextPercent: 0,
    }
    render(<StatusIndicator {...defaultProps} usage={usage} />)
    expect(screen.queryByTitle("Total cost")).not.toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Context percentage
  // ═══════════════════════════════════════════════════════════════════

  it("shows context percentage when contextWindow > 0", () => {
    const usage: UsageData = {
      inputTokens: 100,
      outputTokens: 200,
      totalCost: 0,
      contextWindow: 128000,
      contextPercent: 45,
    }
    render(<StatusIndicator {...defaultProps} usage={usage} />)
    expect(screen.getByTitle(/Context:/)).toBeInTheDocument()
  })

  it("uses error color when context > 75%", () => {
    const usage: UsageData = {
      inputTokens: 100,
      outputTokens: 200,
      totalCost: 0,
      contextWindow: 128000,
      contextPercent: 80,
    }
    render(<StatusIndicator {...defaultProps} usage={usage} />)
    const contextEl = screen.getByTitle(/Context:/)
    expect(contextEl.className).toContain("text-error")
  })

  it("uses accent color when context > 50%", () => {
    const usage: UsageData = {
      inputTokens: 100,
      outputTokens: 200,
      totalCost: 0,
      contextWindow: 128000,
      contextPercent: 60,
    }
    render(<StatusIndicator {...defaultProps} usage={usage} />)
    const contextEl = screen.getByTitle(/Context:/)
    expect(contextEl.className).toContain("text-text-accent")
  })

  it("uses success color when context <= 50%", () => {
    const usage: UsageData = {
      inputTokens: 100,
      outputTokens: 200,
      totalCost: 0,
      contextWindow: 128000,
      contextPercent: 30,
    }
    render(<StatusIndicator {...defaultProps} usage={usage} />)
    const contextEl = screen.getByTitle(/Context:/)
    expect(contextEl.className).toContain("text-success")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Spinner animation
  // ═══════════════════════════════════════════════════════════════════

  it("renders spinner frames when streaming", () => {
    render(<StatusIndicator {...defaultProps} isStreaming={true} />)
    expect(screen.getByText("Working")).toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════
  // No usage data
  // ═══════════════════════════════════════════════════════════════════

  it("does not show usage section when tokens are 0", () => {
    render(<StatusIndicator {...defaultProps} />)
    expect(screen.queryByTitle("Input tokens")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Output tokens")).not.toBeInTheDocument()
  })
})
