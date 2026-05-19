// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { UIDialog } from "@/renderer/src/components/chat/UIDialog"
import type { PendingUIRequest } from "@/renderer/src/hooks/useUIRequests"
import type { UIRequest } from "@/shared/ipc-types"

// ── Helpers ──────────────────────────────────────────────────────────

function makeUIRequest(overrides: Partial<UIRequest> = {}): UIRequest {
  return {
    id: "ui-1",
    sessionId: "sess-1",
    type: "select",
    title: "Choose an option",
    ...overrides,
  }
}

function makePending(overrides: Partial<PendingUIRequest> = {}): PendingUIRequest {
  return {
    request: makeUIRequest(),
    localState: { highlightedIndex: -1, inputValue: "" },
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe("UIDialog", () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const updateLocalState = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Null / Hidden State
  // ═══════════════════════════════════════════════════════════════════

  it("renders nothing when pending is null", () => {
    const { container } = render(
      <UIDialog pending={null} onConfirm={onConfirm} onCancel={onCancel} updateLocalState={updateLocalState} />
    )
    expect(container.innerHTML).toBe("")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Select Dialog
  // ═══════════════════════════════════════════════════════════════════

  it("renders Select header with title", () => {
    render(
      <UIDialog
        pending={makePending({ request: makeUIRequest({ type: "select", title: "Pick Tool" }) })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("Select")).toBeTruthy()
    expect(screen.getByText("Pick Tool")).toBeTruthy()
  })

  it("renders select options", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({
            type: "select",
            options: [
              { label: "Option A", value: "a" },
              { label: "Option B", value: "b" },
            ],
          }),
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("Option A")).toBeTruthy()
    expect(screen.getByText("Option B")).toBeTruthy()
  })

  it("renders option descriptions", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({
            type: "select",
            options: [
              { label: "Option A", value: "a", description: "Desc A" },
            ],
          }),
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("Desc A")).toBeTruthy()
  })

  it("renders option count in footer", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({
            type: "select",
            options: [
              { label: "A", value: "a" },
              { label: "B", value: "b" },
              { label: "C", value: "c" },
            ],
          }),
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("3 options")).toBeTruthy()
  })

  it("calls onConfirm when clicking an option", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({
            type: "select",
            options: [{ label: "Option A", value: "a" }],
          }),
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    fireEvent.click(screen.getByText("Option A"))
    expect(onConfirm).toHaveBeenCalledWith("a")
  })

  it("calls onConfirm with label when option has no value", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({
            type: "select",
            options: [{ label: "Option A" }],
          }),
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    fireEvent.click(screen.getByText("Option A"))
    expect(onConfirm).toHaveBeenCalledWith("Option A")
  })

  it("calls updateLocalState on mouse enter of option", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({
            type: "select",
            options: [{ label: "Option A", value: "a" }],
          }),
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    fireEvent.mouseEnter(screen.getByText("Option A"))
    expect(updateLocalState).toHaveBeenCalledWith({ highlightedIndex: 0 })
  })

  it("renders description text when present", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({
            type: "select",
            description: "Please choose one",
          }),
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("Please choose one")).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Confirm Dialog
  // ═══════════════════════════════════════════════════════════════════

  it("renders Confirm header with title", () => {
    render(
      <UIDialog
        pending={makePending({ request: makeUIRequest({ type: "confirm", title: "Are you sure?" }) })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("Confirm")).toBeTruthy()
    expect(screen.getByText("Are you sure?")).toBeTruthy()
  })

  it("renders OK button for non-dangerous confirm", () => {
    render(
      <UIDialog
        pending={makePending({ request: makeUIRequest({ type: "confirm", dangerous: false }) })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("OK")).toBeTruthy()
  })

  it("renders Confirm button for dangerous confirm", () => {
    render(
      <UIDialog
        pending={makePending({ request: makeUIRequest({ type: "confirm", dangerous: true }) })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    // "Confirm" appears in both header label and button; find the button
    const confirmElements = screen.getAllByText("Confirm")
    const confirmButton = confirmElements.find(el => el.tagName === "BUTTON")
    expect(confirmButton).toBeTruthy()
  })

  it("renders Cancel button", () => {
    render(
      <UIDialog
        pending={makePending({ request: makeUIRequest({ type: "confirm" }) })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("Cancel")).toBeTruthy()
  })

  it("calls onConfirm when clicking OK", () => {
    render(
      <UIDialog
        pending={makePending({ request: makeUIRequest({ type: "confirm" }) })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    fireEvent.click(screen.getByText("OK"))
    expect(onConfirm).toHaveBeenCalled()
  })

  it("calls onCancel when clicking Cancel", () => {
    render(
      <UIDialog
        pending={makePending({ request: makeUIRequest({ type: "confirm" }) })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    fireEvent.click(screen.getByText("Cancel"))
    expect(onCancel).toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Input Dialog
  // ═══════════════════════════════════════════════════════════════════

  it("renders Input header with title", () => {
    render(
      <UIDialog
        pending={makePending({ request: makeUIRequest({ type: "input", title: "Enter name" }) })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("Input")).toBeTruthy()
    expect(screen.getByText("Enter name")).toBeTruthy()
  })

  it("renders text input with placeholder", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({ type: "input", placeholder: "Type here..." }),
          localState: { highlightedIndex: -1, inputValue: "" },
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    const input = screen.getByPlaceholderText("Type here...")
    expect(input).toBeTruthy()
  })

  it("calls updateLocalState when typing", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({ type: "input" }),
          localState: { highlightedIndex: -1, inputValue: "" },
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "hello" } })
    expect(updateLocalState).toHaveBeenCalledWith({ inputValue: "hello" })
  })

  it("Submit button is disabled when input is empty", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({ type: "input" }),
          localState: { highlightedIndex: -1, inputValue: "" },
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    const submitBtn = screen.getByText("Submit")
    expect(submitBtn).toBeTruthy()
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it("calls onConfirm with inputValue when clicking Submit", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({ type: "input" }),
          localState: { highlightedIndex: -1, inputValue: "my answer" },
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    fireEvent.click(screen.getByText("Submit"))
    expect(onConfirm).toHaveBeenCalledWith(undefined, "my answer")
  })

  it("renders description text when present on input dialog", () => {
    render(
      <UIDialog
        pending={makePending({
          request: makeUIRequest({ type: "input", description: "Please enter a value" }),
          localState: { highlightedIndex: -1, inputValue: "" },
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
        updateLocalState={updateLocalState}
      />
    )
    expect(screen.getByText("Please enter a value")).toBeTruthy()
  })
})
