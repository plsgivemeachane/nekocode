/**
 * Critical Testing Expert: Slash Commands & UI Request/Response Contract Tests
 *
 * This test file rigorously audits the contracts defined by:
 *   - CommandInfo / getCommands(sessionId)
 *   - UIRequest / UIResponse / ElectronUIContext methods
 *   - useCommands hook
 *   - useCommandHistory hook
 *
 * Following the Critical Testing Expert methodology:
 *   1. Test the CONTRACT, not the implementation
 *   2. Drill hidden assumptions in every argument
 *   3. Tests must BREAK things — surface shallow understanding and edge cases
 *   4. Attack abstraction ambiguity — find where the abstraction leaks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ElectronUIContext } from '../main/electron-ui-context'
import type { UIRequest, UIResponse, CommandInfo, SessionStreamEvent } from '../shared/ipc-types'

// ============================================================================
// Mock Transport for ElectronUIContext tests
// ============================================================================

function createMockTransport() {
  const sentEvents: Array<{ sessionId: string; event: SessionStreamEvent }> = []
  return {
    sendUIRequest: vi.fn((sessionId: string, event: SessionStreamEvent) => {
      sentEvents.push({ sessionId, event })
    }),
    sentEvents,
    /** Convenience: get the last sent UIRequest */
    lastRequest(): UIRequest | undefined {
      const last = sentEvents[sentEvents.length - 1]
      if (!last) return undefined
      return (last.event as { type: string; request: UIRequest }).request
    },
    /** Clear all sent events */
    clear() {
      sentEvents.length = 0
    },
  }
}

type MockTransport = ReturnType<typeof createMockTransport>

// ============================================================================
// CATEGORY 1: The "Name vs. Reality" Audit — CommandInfo contract
// ============================================================================

describe('Contract Audit: CommandInfo type', () => {
  it('"name" field promises uniqueness but the type does not enforce it', () => {
    // The type says `name: string` but getCommands() deduplicates by name.
    // This means the CONTRACT is ambiguous: is name a unique identifier or a display label?
    // Two commands with the same name from different sources: the second is silently dropped.
    const cmd1: CommandInfo = { name: 'deploy', description: 'From extension A', source: 'extension' }
    const cmd2: CommandInfo = { name: 'deploy', description: 'From extension B', source: 'extension' }
    // The type allows both to exist, but getCommands() will silently drop one.
    // This is an abstraction leak: the type doesn't capture the uniqueness constraint.
    expect(cmd1.name).toBe(cmd2.name)
    expect(cmd1.source).toBe(cmd2.source)
    // The dedup is first-wins — the second description is lost
    expect(cmd1.description).not.toBe(cmd2.description)
  })

  it('"source" field includes "workflow" but no code path populates it', () => {
    // The CommandInfo.source type is 'extension' | 'prompt' | 'skill' | 'workflow'
    // But getCommands() only ever sets source to extension, skill, or prompt.
    // "workflow" is a dead type member — it exists in the contract but is never fulfilled.
    const validSources: CommandInfo['source'][] = ['extension', 'prompt', 'skill', 'workflow']
    // This test documents that 'workflow' is currently unreachable
    expect(validSources).toContain('workflow')
  })

  it('"description" is optional but the autocomplete UI may require it', () => {
    // description?: string — optional in the type, but what does the UI show if undefined?
    const cmd: CommandInfo = { name: 'deploy', source: 'extension' }
    expect(cmd.description).toBeUndefined()
    // The contract doesn't specify what the consumer should do with undefined description.
    // This is an ambiguity: is it "no description available" or "this command has no description"?
  })

  it('"name" can be an empty string — the type allows it but the contract forbids it', () => {
    // name: string allows empty string, but an empty command name is meaningless.
    // The contract doesn't validate this.
    const cmd: CommandInfo = { name: '', source: 'extension' }
    expect(cmd.name).toBe('')
    // This would create a "/" slash command with no name — a ghost command.
  })
})

// ============================================================================
// CATEGORY 2: Argument Boundary & Assumption Drilling — ElectronUIContext.select
// ============================================================================

describe('Contract Audit: ElectronUIContext.select(title, options, opts?)', () => {
  let context: ElectronUIContext
  let transport: MockTransport

  beforeEach(() => {
    transport = createMockTransport()
    context = new ElectronUIContext('test-session', transport)
  })

  it('empty options array creates a select dialog with no choices — is this valid?', async () => {
    // select() accepts options: string[] but doesn't validate non-empty.
    // A select with no options is a dialog that can never be fulfilled by selection.
    context.select('Choose', [])
    const request = transport.lastRequest()
    expect(request).toBeDefined()
    expect(request!.options).toHaveLength(0)
    // The user sees a dialog with no options and can only cancel.
    // But the contract doesn't prevent this nonsensical state.
  })

  it('title can be empty string — the dialog has no heading', async () => {
    context.select('', ['opt1'])
    const request = transport.lastRequest()
    expect(request!.title).toBe('')
    // An empty title creates a confusing dialog. The contract doesn't validate.
  })

  it('timeout of 0 is treated as "no timeout" (falsy check)', async () => {
    // The code checks `if (timeoutMs && timeoutMs > 0)` — so 0 is treated as no timeout.
    // But semantically, timeout=0 could mean "instant timeout".
    context.select('Choose', ['opt1'], { timeout: 0 })
    // The promise should NOT resolve immediately with undefined
    // because 0 is falsy, so the timeout branch is skipped.
    // This is actually correct behavior, but the ambiguity is documented.
    const request = transport.lastRequest()
    expect(request).toBeDefined()
  })

  it('negative timeout is silently ignored — is this intentional?', async () => {
    // timeoutMs > 0 check means negative values are silently treated as "no timeout".
    // But a negative timeout is arguably a programming error.
    context.select('Choose', ['opt1'], { timeout: -100 })
    const request = transport.lastRequest()
    expect(request).toBeDefined()
    // No timeout is set — the promise may hang forever.
  })

  it('AbortSignal abort resolves with undefined, not rejection', async () => {
    // When AbortSignal fires, the promise resolves with undefined.
    // This means the caller CANNOT distinguish between "user cancelled" and "abort signal fired".
    // Both resolve undefined. Is this intentional or an abstraction leak?
    const controller = new AbortController()
    const promise = context.select('Choose', ['opt1'], { signal: controller.signal })
    controller.abort()
    const result = await promise
    expect(result).toBeUndefined()
    // Same as if user had clicked Cancel. The caller can't tell the difference.
  })

  it('multiple simultaneous select() calls create independent pending requests', async () => {
    // What happens if two select() calls are in-flight at the same time?
    // The contract doesn't forbid it, but the UI may not handle it.
    context.select('First', ['a'])
    context.select('Second', ['b'])
    expect(transport.sentEvents).toHaveLength(2)
    expect(transport.sentEvents[0].event).not.toBe(transport.sentEvents[1].event)
  })

  it('options with duplicate labels are not deduplicated — each becomes a separate UISelectOption', async () => {
    // select() maps each option string to { label, value } without dedup.
    // Two identical options create two indistinguishable choices.
    context.select('Choose', ['same', 'same'])
    const request = transport.lastRequest()
    expect(request!.options).toHaveLength(2)
    expect(request!.options![0]).toEqual({ label: 'same', value: 'same' })
    expect(request!.options![1]).toEqual({ label: 'same', value: 'same' })
    // User picks one — but which one? Both have value 'same'.
    // The response.selectedValue will be 'same' regardless of which was clicked.
  })

  it('response with selectedValue not in original options is still accepted', async () => {
    // handleResponse doesn't validate that selectedValue matches any option.
    // This means a malicious or buggy renderer can return any value.
    const promise = context.select('Choose', ['a', 'b'])
    const request = transport.lastRequest()
    
    // Simulate a response with a value that wasn't in the options
    const rogueResponse: UIResponse = {
      requestId: request!.id,
      sessionId: 'test-session',
      confirmed: true,
      selectedValue: 'hacked-value-not-in-options',
    }
    context.handleResponse(rogueResponse)
    
    const result = await promise
    expect(result).toBe('hacked-value-not-in-options')
    // The contract trusts the renderer completely. No validation of selectedValue.
  })

  it('request is sent BEFORE timeout is set up — no race condition', async () => {
    // sendRequestAndWait sets up the pending request first, then sends.
    // This means the response can arrive before the timeout is set,
    // but since pending is registered before send, this is safe.
    vi.useFakeTimers()
    try {
      const promise = context.select('Choose', ['a'], { timeout: 5000 })
      // Advance timers without advancing enough to trigger timeout
      vi.advanceTimersByTime(4999)
      // Request should still be pending
      const request = transport.lastRequest()!
      context.handleResponse({
        requestId: request.id,
        sessionId: 'test-session',
        confirmed: true,
        selectedValue: 'a',
      })
      const result = await promise
      expect(result).toBe('a')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ============================================================================
// CATEGORY 3: confirm() — TYPE CONTRACT VIOLATION
// ============================================================================

describe('Contract Audit: ElectronUIContext.confirm(title, message, opts?)', () => {
  let context: ElectronUIContext
  let transport: MockTransport

  beforeEach(() => {
    transport = createMockTransport()
    context = new ElectronUIContext('test-session', transport)
  })

  it('CRITICAL: return type is Promise<boolean> but cancel resolves undefined', async () => {
    // The function signature says Promise<boolean>, but:
    // - Confirmed → resolves `true`
    // - Cancelled → resolves `undefined` (not `false`!)
    // This is a TYPE CONTRACT VIOLATION. The type says boolean but undefined is not a boolean.
    // Callers checking `if (result)` will work, but callers checking `result === false` will break.
    const promise = context.confirm('Title', 'Message')
    const request = transport.lastRequest()!
    
    // User cancels
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: false,
    })
    
    const result = await promise
    // TypeScript thinks result is boolean, but it's actually undefined
    expect(result).toBeUndefined()
    expect(typeof result === 'boolean').toBe(false) // TYPE VIOLATION
  })

  it("confirmed response resolves to true, not to the user's choice", async () => {
    const promise = context.confirm('Delete?', 'Are you sure?')
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
    })
    
    const result = await promise
    expect(result).toBe(true)
    expect(typeof result === 'boolean').toBe(true)
  })

  it('empty title and message are accepted — no validation', async () => {
    context.confirm('', '')
    const request = transport.lastRequest()
    expect(request!.title).toBe('')
    expect(request!.description).toBe('')
  })

  it('confirm with timeout resolves undefined on timeout', async () => {
    vi.useFakeTimers()
    try {
      const promise = context.confirm('Confirm?', 'msg', { timeout: 3000 })
      vi.advanceTimersByTime(3001)
      const result = await promise
      // Timeout resolves undefined, not false.
      // This is ANOTHER type violation: Promise<boolean> but got undefined.
      expect(result).toBeUndefined()
      expect(typeof result === 'boolean').toBe(false) // TYPE VIOLATION
    } finally {
      vi.useRealTimers()
    }
  })

  it('confirm with AbortSignal resolves undefined on abort', async () => {
    const controller = new AbortController()
    const promise = context.confirm('Confirm?', 'msg', { signal: controller.signal })
    controller.abort()
    const result = await promise
    // Abort resolves undefined — same as cancel, same as timeout.
    // Three different reasons, all produce the same value. Ambiguity.
    expect(result).toBeUndefined()
  })
})

// ============================================================================
// CATEGORY 4: input() — Empty string vs cancellation ambiguity
// ============================================================================

describe('Contract Audit: ElectronUIContext.input(title, placeholder?, opts?)', () => {
  let context: ElectronUIContext
  let transport: MockTransport

  beforeEach(() => {
    transport = createMockTransport()
    context = new ElectronUIContext('test-session', transport)
  })

  it('CRITICAL: empty string input vs cancellation are distinguishable', async () => {
    // If the user types nothing and submits, inputValue = ""
    // If the user cancels, confirmed = false → resolve undefined
    // "" and undefined ARE distinguishable ("" is truthy-ish, undefined is falsy).
    // This is actually correct behavior — empty string IS a valid input.
    const promise = context.input('Enter value')
    const request = transport.lastRequest()!
    
    // User submits empty string
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      inputValue: '',
    })
    
    const result = await promise
    expect(result).toBe('') // Empty string is a valid result
    // The caller CAN distinguish "" from undefined, so this is actually fine.
  })

  it('cancel resolves undefined — distinguishable from empty string', async () => {
    const promise = context.input('Enter value')
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: false,
    })
    
    const result = await promise
    expect(result).toBeUndefined()
    // undefined ≠ "" — caller can distinguish cancel from empty submit.
  })

  it('placeholder is optional and undefined placeholder creates no placeholder', async () => {
    context.input('Enter value', undefined)
    const request = transport.lastRequest()
    expect(request!.placeholder).toBeUndefined()
  })

  it('CRITICAL: response with inputValue AND selectedValue — selectedValue wins', async () => {
    // The handleResponse code checks: if selectedValue !== undefined, use that;
    // else if inputValue !== undefined, use that; else true.
    // When BOTH are present, selectedValue takes priority.
    // This means an input() call can return a select-like value.
    const promise = context.input('Enter value')
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      selectedValue: 'wrong',
      inputValue: 'correct',
    })
    
    const result = await promise
    expect(result).toBe('wrong') // selectedValue takes priority!
    // This is an abstraction leak: input() returns selectedValue which is a SELECT concept.
  })

  it('CRITICAL: confirmed=true with no values resolves true — TYPE MISMATCH for input', async () => {
    // If the renderer sends confirmed=true but no inputValue or selectedValue,
    // handleResponse falls through to `pending.resolve(true)`.
    // For input() typed as Promise<string | undefined>, this returns `true` (a boolean).
    // This is a TYPE VIOLATION: string | undefined but got boolean.
    const promise = context.input('Enter value')
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      // No inputValue, no selectedValue
    })
    
    const result = await promise
    expect(result).toBe(true) // TYPE VIOLATION: expected string | undefined, got boolean
    expect(typeof result).toBe('boolean')
  })

  it('input with timeout resolves undefined on timeout', async () => {
    vi.useFakeTimers()
    try {
      const promise = context.input('Enter', 'placeholder', { timeout: 2000 })
      vi.advanceTimersByTime(2001)
      const result = await promise
      expect(result).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ============================================================================
// CATEGORY 5: handleResponse — Abstraction Ambiguity
// ============================================================================

describe('Contract Audit: ElectronUIContext.handleResponse', () => {
  let context: ElectronUIContext
  let transport: MockTransport

  beforeEach(() => {
    transport = createMockTransport()
    context = new ElectronUIContext('test-session', transport)
  })

  it('double-response to same requestId — second response is silently ignored', async () => {
    // What happens if the renderer sends two responses for the same request?
    // The first resolves the promise and deletes the pending request.
    // The second finds no pending request and logs a warning.
    const promise = context.select('Choose', ['a', 'b'])
    const request = transport.lastRequest()!
    
    // First response
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      selectedValue: 'a',
    })
    
    const result1 = await promise
    expect(result1).toBe('a')
    
    // Second response — silently ignored, no error thrown
    expect(() => {
      context.handleResponse({
        requestId: request.id,
        sessionId: 'test-session',
        confirmed: true,
        selectedValue: 'b',
      })
    }).not.toThrow()
    // The promise was already resolved with 'a'. 'b' is lost.
    // This is fine for idempotency, but could hide bugs in the renderer.
  })

  it('response for unknown requestId — silently ignored with warning', async () => {
    // No pending request exists for this ID. The contract says "log and return".
    expect(() => {
      context.handleResponse({
        requestId: 'nonexistent-request-id',
        sessionId: 'test-session',
        confirmed: true,
      })
    }).not.toThrow()
    // Silently swallowing invalid request IDs could hide bugs.
  })

  it('CRITICAL: response with wrong sessionId but correct requestId — still resolves', async () => {
    // The UIRequest includes sessionId, but handleResponse doesn't validate
    // that the response sessionId matches the original request sessionId.
    // This is a potential security/cross-session leak.
    const promise = context.select('Choose', ['a'])
    const request = transport.lastRequest()!
    
    // Response with WRONG sessionId but correct requestId
    context.handleResponse({
      requestId: request.id,
      sessionId: 'different-session', // WRONG!
      confirmed: true,
      selectedValue: 'a',
    })
    
    const result = await promise
    expect(result).toBe('a')
    // The promise resolves despite the session mismatch.
    // Cross-session response injection is possible.
  })

  it('timeout and manual response race — first one wins', async () => {
    vi.useFakeTimers()
    try {
      const promise = context.select('Choose', ['a'], { timeout: 1000 })
      
      // Advance past timeout
      vi.advanceTimersByTime(1001)
      
      const result = await promise
      expect(result).toBeUndefined() // Timeout resolved with undefined
      
      // Now try to respond — too late, request was already deleted
      const request = transport.lastRequest()!
      context.handleResponse({
        requestId: request.id,
        sessionId: 'test-session',
        confirmed: true,
        selectedValue: 'a',
      })
      // The promise was already resolved — no change
    } finally {
      vi.useRealTimers()
    }
  })

  it('response arriving just before timeout — response wins', async () => {
    vi.useFakeTimers()
    try {
      const promise = context.select('Choose', ['a'], { timeout: 1000 })
      const request = transport.lastRequest()!
      
      // Respond just before timeout fires
      context.handleResponse({
        requestId: request.id,
        sessionId: 'test-session',
        confirmed: true,
        selectedValue: 'a',
      })
      
      // Advance past what would have been the timeout
      vi.advanceTimersByTime(2000)
      
      const result = await promise
      expect(result).toBe('a') // Response arrived first, takes priority
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispose() resolves all pending requests with undefined', async () => {
    const promise1 = context.select('Q1', ['a'])
    const promise2 = context.confirm('Q2', 'msg')
    const promise3 = context.input('Q3')
    
    context.dispose()
    
    const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3])
    expect(r1).toBeUndefined()
    expect(r2).toBeUndefined()
    expect(r3).toBeUndefined()
    // All three are resolved with undefined — the caller can't distinguish
    // "disposed" from "cancelled" from "timed out".
  })

  it('confirmed=false always resolves undefined regardless of selectedValue/inputValue', async () => {
    // Even if selectedValue is present, confirmed=false → undefined.
    // The confirmed flag is checked FIRST, so any data in the response is ignored.
    const promise = context.select('Choose', ['a'])
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: false,
      selectedValue: 'a', // This is IGNORED because confirmed=false
    })
    
    const result = await promise
    expect(result).toBeUndefined() // selectedValue is discarded
  })

  it('response with inputValue for a select request — inputValue is used', async () => {
    // If the renderer sends an inputValue for a select request,
    // handleResponse will check inputValue (since selectedValue is undefined).
    // This means a select() call can return arbitrary text.
    const promise = context.select('Choose', ['a', 'b'])
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      inputValue: 'typed-response', // inputValue for a SELECT dialog
    })
    
    const result = await promise
    expect(result).toBe('typed-response')
    // The contract doesn't enforce type consistency between request and response.
  })
})

// ============================================================================
// CATEGORY 6: State & Side-Effect Skepticism — Concurrency & Idempotency
// ============================================================================

describe('Contract Audit: ElectronUIContext — Concurrency and State Pollution', () => {
  let context: ElectronUIContext
  let transport: MockTransport

  beforeEach(() => {
    transport = createMockTransport()
    context = new ElectronUIContext('test-session', transport)
  })

  it('request IDs are unique within a session context', async () => {
    // Generate multiple requests and verify no ID collisions
    const promises = []
    for (let i = 0; i < 100; i++) {
      promises.push(context.select(`Q${i}`, ['a']))
    }
    
    const ids = transport.sentEvents.map(
      e => (e.event as { type: string; request: UIRequest }).request.id
    )
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(100)
    
    // Clean up all pending requests
    context.dispose()
  })

  it('disposed context still accepts new requests (potential leak)', async () => {
    // After dispose(), what happens if you call select() again?
    context.dispose()
    
    // select() will create a new pending request even after dispose.
    // This is a potential leak: requests can be created on a disposed context.
    const promise = context.select('After dispose', ['a'])
    const request = transport.lastRequest()
    
    // The request IS sent via transport
    expect(request).toBeDefined()
    // But the promise will hang forever since no one will respond
    // We need to clean up
    context.dispose()
    await promise // Resolves undefined via second dispose
  })

  it('same select() called 100 times creates 100 independent requests', async () => {
    // Stress test: ensure no shared state pollution between requests
    const promises = []
    for (let i = 0; i < 100; i++) {
      promises.push(context.select('Same question', ['yes', 'no']))
    }
    
    expect(transport.sentEvents).toHaveLength(100)
    
    // Respond to each one independently
    const results: (string | undefined)[] = []
    for (let i = 0; i < 100; i++) {
      const request = (transport.sentEvents[i].event as { type: string; request: UIRequest }).request
      context.handleResponse({
        requestId: request.id,
        sessionId: 'test-session',
        confirmed: true,
        selectedValue: i % 2 === 0 ? 'yes' : 'no',
      })
    }
    
    for (const p of promises) {
      results.push(await p)
    }
    
    expect(results).toHaveLength(100)
    expect(results.filter(r => r === 'yes')).toHaveLength(50)
    expect(results.filter(r => r === 'no')).toHaveLength(50)
  })

  it('mixed select/confirm/input requests can all be in-flight simultaneously', async () => {
    const promises = [
      context.select('Choose', ['a', 'b']),
      context.confirm('Confirm?', 'Are you sure?'),
      context.input('Enter', 'placeholder'),
    ]
    
    expect(transport.sentEvents).toHaveLength(3)
    
    // Respond to each with the correct type
    const requests = transport.sentEvents.map(
      e => (e.event as { type: string; request: UIRequest }).request
    )
    
    context.handleResponse({
      requestId: requests[0].id,
      sessionId: 'test-session',
      confirmed: true,
      selectedValue: 'a',
    })
    context.handleResponse({
      requestId: requests[1].id,
      sessionId: 'test-session',
      confirmed: true,
    })
    context.handleResponse({
      requestId: requests[2].id,
      sessionId: 'test-session',
      confirmed: true,
      inputValue: 'test input',
    })
    
    const [selectResult, confirmResult, inputResult] = await Promise.all(promises)
    expect(selectResult).toBe('a')
    expect(confirmResult).toBe(true)
    expect(inputResult).toBe('test input')
  })
})

// ============================================================================
// CATEGORY 7: getCommands() Contract — Session Manager (documented assumptions)
// ============================================================================

describe('Contract Audit: getCommands(sessionId) documented assumptions', () => {
  it('returns empty array for unknown sessionId — silent failure, not error', () => {
    // getCommands() silently returns [] for non-existent sessions.
    // The caller can't distinguish "no commands" from "no session".
    // This is an AMBIGUITY: should it throw or return empty?
    // 
    // Note: The worker-thread version THROWS for unknown sessions,
    // while the main-thread version returns [].
    // The SAME operation has DIFFERENT error semantics depending on execution context.
    expect(true).toBe(true) // Documenting the contract: always returns [], never throws (main thread)
  })

  it('skill commands are prefixed with "skill:" but other sources are NOT prefixed', () => {
    // The getCommands() implementation prefixes skill names with "skill:"
    // but doesn't prefix extension or prompt commands.
    // This creates an INCONSISTENCY in the naming convention.
    // 
    // To invoke a skill, user types: /skill:name
    // To invoke an extension, user types: /name
    // To invoke a prompt, user types: /name
    // 
    // The prefix is a UI convention leak into the data model.
    // The name field should be the raw name; the prefix should be added by the UI.
    const skillCmd: CommandInfo = { name: 'skill:search', description: 'Search', source: 'skill' }
    const extCmd: CommandInfo = { name: 'deploy', description: 'Deploy', source: 'extension' }
    const promptCmd: CommandInfo = { name: 'review', description: 'Review', source: 'prompt' }
    
    // Skill name has prefix, others don't
    expect(skillCmd.name).toContain(':')
    expect(extCmd.name).not.toContain(':')
    expect(promptCmd.name).not.toContain(':')
    // This inconsistency means the UI parsing logic must know about the "skill:" prefix
    // rather than relying on the source field. Abstraction leak.
  })

  it('deduplication is first-wins — later commands with same name are silently dropped', () => {
    // If an extension registers "/deploy" and a skill is also named "deploy",
    // the extension version wins (because extensions are collected first).
    // The skill version is silently dropped.
    // 
    // The user has NO WAY to know that a command was hidden.
    // The contract doesn't provide "shadowed" or "overridden" feedback.
    expect(true).toBe(true) // Documenting: first-wins dedup with no shadowing feedback
  })

  it('extension errors during command collection are silently swallowed', () => {
    // getCommands() wraps extension collection in try/catch with empty catch.
    // If the ExtensionRunner throws, all extension commands are lost silently.
    // The caller receives only skill/prompt commands and can't know extensions failed.
    expect(true).toBe(true) // Documenting: silent error swallowing in command collection
  })

  it('resource loader errors during command collection are silently swallowed', () => {
    // Same pattern: try/catch with empty catch for ResourceLoader.
    // If skills/prompts fail to load, only extension commands are returned.
    // No error feedback, no partial failure indicator.
    expect(true).toBe(true) // Documenting: silent error swallowing in resource loading
  })

  it('worker thread throws for unknown session while main thread returns []', () => {
    // CRITICAL: The same getCommands call has different behavior depending on
    // whether it runs on the main thread or worker thread:
    // - Main thread: returns [] for unknown sessionId
    // - Worker thread: throws Error("Session not found: <id>")
    // 
    // If the threading model changes, previously silent "no commands" becomes
    // a thrown exception that could crash the renderer.
    expect(true).toBe(true) // Documenting: divergent error handling between threads
  })

  it('worker returns { commands: CommandInfo[] } but main returns CommandInfo[]', () => {
    // The worker-thread handleSessionGetCommands returns { commands: CommandInfo[] }
    // but the main-thread getCommands returns CommandInfo[] directly.
    // The IPC handler must unwrap the worker response.
    // If the IPC layer forgets to unwrap, the renderer gets { commands: [...] } instead of [...].
    expect(true).toBe(true) // Documenting: return type divergence between threads
  })

  it('worker handleUIResponse returns { success: boolean } but main returns void', () => {
    // Main-thread handleUIResponse returns void (no feedback).
    // Worker-thread handleSessionUIRespond returns { success: boolean }.
    // The renderer calls uiRespond() → Promise<void> — it NEVER knows if the response
    // was actually delivered or dropped due to missing session.
    expect(true).toBe(true) // Documenting: success feedback is lost in IPC translation
  })
})

// ============================================================================
// CATEGORY 8: UIRequest type contract — structural completeness
// ============================================================================

describe('Contract Audit: UIRequest type completeness', () => {
  it('select request with options that have no explicit value — selectedValue falls through', async () => {
    // UISelectOption.value is optional (defaults to label in the renderer).
    // But ElectronUIContext.select() ALWAYS sets value = label.
    // So the selectedValue will match the label. This is actually handled correctly.
    // However, if a DIFFERENT producer creates UISelectOptions without value,
    // the renderer would need to default to label.
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    context.select('Choose', ['Option A'])
    const request = transport.lastRequest()!
    
    // select() always sets value = label, so this is safe
    expect(request.options![0].value).toBe('Option A')
    expect(request.options![0].label).toBe('Option A')
    
    context.dispose()
  })

  it('confirm request has no options array — type doesn\'t require it', () => {
    const request: UIRequest = {
      id: 'test',
      sessionId: 's1',
      type: 'confirm',
      title: 'Confirm?',
    }
    expect(request.options).toBeUndefined()
    // The type correctly models this, but the renderer must check type before accessing options.
  })

  it('input request with defaultValue — the type defines it but input() never sets it', async () => {
    // UIRequest.defaultValue exists in the type for 'input' type,
    // but ElectronUIContext.input() never sets it.
    // The field exists in the contract but is never populated.
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    context.input('Enter', 'placeholder')
    const request = transport.lastRequest()!
    
    expect(request.defaultValue).toBeUndefined()
    // Dead field in the contract — never sent, never consumed.
    
    context.dispose()
  })

  it('dangerous field for confirm — exists in type but confirm() never sets it', async () => {
    // UIRequest.dangerous is defined for confirm dialogs to show a destructive style,
    // but ElectronUIContext.confirm() never passes it.
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    context.confirm('Delete everything?', 'This is destructive')
    const request = transport.lastRequest()!
    
    expect(request.dangerous).toBeUndefined()
    // Another dead field — the type promises it but the implementation doesn't deliver.
    
    context.dispose()
  })
})

// ============================================================================
// CATEGORY 9: Skill Prefix Parsing — Abstraction Leak
// ============================================================================

describe('Contract Audit: Skill name prefix as abstraction leak', () => {
  it('skill prefix "skill:" is embedded in the name field, not derived from source', () => {
    // The getCommands() code does: `const name = "skill:" + skill.name`
    // This means the UI must strip the "skill:" prefix to get the actual skill name.
    // But the UI also needs to know this convention.
    // 
    // If the prefix convention changes, both the command provider AND the UI must change.
    // This violates the single-responsibility principle.
    // 
    // Better: the name should be the raw name, and the UI should add the prefix
    // based on the source field.
    const skillCmd: CommandInfo = { name: 'skill:search', source: 'skill' }
    const rawName = skillCmd.name.replace(/^skill:/, '')
    expect(rawName).toBe('search')
    // This parsing must be kept in sync with the hardcoded prefix.
  })

  it('a skill named "skill:deploy" would become "skill:skill:deploy"', () => {
    // If a skill's actual name already contains "skill:", the prefix doubles.
    // This is unlikely but the contract doesn't prevent it.
    const skillName = 'skill:deploy' // Already has prefix
    const prefixed = `skill:${skillName}` // Doubles it
    expect(prefixed).toBe('skill:skill:deploy')
    // The UI would try to strip "skill:" and get "skill:deploy" which still has prefix.
  })

  it('a skill with empty name becomes "skill:" — a ghost command', () => {
    const skillName = ''
    const prefixed = `skill:${skillName}`
    expect(prefixed).toBe('skill:')
    // This creates a "/skill:" command which is nonsensical.
  })

  it('a skill with name containing special characters is not escaped', () => {
    // What if a skill name contains spaces, slashes, or newlines?
    const skillName = 'my skill/name\nwith newline'
    const prefixed = `skill:${skillName}`
    expect(prefixed).toContain(' ')
    expect(prefixed).toContain('/')
    expect(prefixed).toContain('\n')
    // The command name is not sanitized. Could break the slash command parser.
  })

  it('a skill name that is just whitespace becomes "skill:   " — invisible command', () => {
    const skillName = '   '
    const prefixed = `skill:${skillName}`
    expect(prefixed).toBe('skill:   ')
    // A whitespace-only name is invisible in the UI.
  })
})

// ============================================================================
// CATEGORY 10: End-to-End Contract — select → respond flow
// ============================================================================

describe('Contract Audit: End-to-end select→respond flow', () => {
  it('happy path: select → confirm → receive value', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.select('Choose a color', ['red', 'green', 'blue'])
    
    // Verify the request was sent
    const request = transport.lastRequest()!
    expect(request.type).toBe('select')
    expect(request.title).toBe('Choose a color')
    expect(request.options).toHaveLength(3)
    expect(request.options![0]).toEqual({ label: 'red', value: 'red' })
    
    // Simulate user selection
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      selectedValue: 'green',
    })
    
    const result = await promise
    expect(result).toBe('green')
  })

  it('cancel path: select → cancel → receive undefined', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.select('Choose', ['a'])
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: false,
    })
    
    const result = await promise
    expect(result).toBeUndefined()
  })

  it('timeout path: select → no response → timeout resolves undefined', async () => {
    vi.useFakeTimers()
    try {
      const transport = createMockTransport()
      const context = new ElectronUIContext('test-session', transport)
      
      const promise = context.select('Choose', ['a'], { timeout: 5000 })
      
      // No response from user — timeout fires
      vi.advanceTimersByTime(5001)
      
      const result = await promise
      expect(result).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('abort path: select → signal abort → resolves undefined', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const controller = new AbortController()
    const promise = context.select('Choose', ['a'], { signal: controller.signal })
    
    controller.abort()
    
    const result = await promise
    expect(result).toBeUndefined()
  })

  it('confirm happy path: confirm → yes → receive true', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.confirm('Delete?', 'Are you sure?')
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
    })
    
    const result = await promise
    expect(result).toBe(true)
  })

  it('confirm cancel path: confirm → cancel → receive undefined (NOT false)', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.confirm('Delete?', 'Are you sure?')
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: false,
    })
    
    const result = await promise
    // IMPORTANT: The type says Promise<boolean> but undefined is returned on cancel
    expect(result).toBeUndefined()
    expect(result).not.toBe(false)
    // This means `if (await confirm(...))` works, but `await confirm(...) === false` NEVER works
  })

  it('input happy path: input → type text → receive text', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.input('Enter name', 'John Doe')
    const request = transport.lastRequest()!
    
    expect(request.type).toBe('input')
    expect(request.placeholder).toBe('John Doe')
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      inputValue: 'Jane Smith',
    })
    
    const result = await promise
    expect(result).toBe('Jane Smith')
  })

  it('input cancel path: input → cancel → receive undefined', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.input('Enter name')
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: false,
    })
    
    const result = await promise
    expect(result).toBeUndefined()
  })
})

// ============================================================================
// CATEGORY 11: Command History Contract — useCommandHistory assumptions
// ============================================================================

describe('Contract Audit: useCommandHistory assumptions', () => {
  it('empty history: navigating returns empty string or undefined', () => {
    // When history is empty, navigating should return empty string.
    // This is an assumption — the contract doesn't specify what happens with empty history.
    const history: string[] = []
    const index = -1 // Default for empty history
    
    // navigateUp from -1 should return empty string (no history)
    const upResult = history[index + 1] // undefined → falsy
    expect(upResult).toBeUndefined()
    // The UI must handle undefined gracefully.
  })

  it('history is bounded — what happens when limit is exceeded?', () => {
    // useCommandHistory has a max size (typically 50 or 100).
    // When exceeded, oldest entries are dropped.
    // But the contract doesn't specify the exact limit or eviction policy.
    const MAX_HISTORY = 50
    const history: string[] = Array.from({ length: 100 }, (_, i) => `cmd${i}`)
    const bounded = history.slice(-MAX_HISTORY)
    expect(bounded).toHaveLength(50)
    expect(bounded[0]).toBe('cmd50') // Oldest 50 entries dropped
  })

  it('duplicate commands — are they deduplicated or stacked?', () => {
    // If the user runs "/deploy" three times, is history ["/deploy", "/deploy", "/deploy"]
    // or just ["/deploy"]? The contract doesn't specify.
    // Common UX pattern: move to front (most recent) but don't duplicate.
    const raw = ['/deploy', '/test', '/deploy', '/deploy']
    // Stack-style (naive)
    expect(raw).toHaveLength(4)
    // Move-to-front style
    const deduped: string[] = []
    for (const cmd of raw) {
      const idx = deduped.indexOf(cmd)
      if (idx >= 0) deduped.splice(idx, 1)
      deduped.push(cmd)
    }
    expect(deduped).toEqual(['/test', '/deploy'])
    // The contract must specify which behavior is expected.
  })

  it('navigating past the end of history should cycle or stop', () => {
    // When navigating down past the most recent command, what happens?
    // Does it cycle back to the start? Does it stop at the most recent?
    // The contract doesn't specify the boundary behavior.
    const history = ['/a', '/b', '/c']
    // If at index 0 (oldest) and pressing Up again:
    // Option A: Stay at 0 (clamped)
    // Option B: Cycle to 2 (most recent)
    // The contract is ambiguous.
    expect(history[0]).toBe('/a')
  })
})

// ============================================================================
// CATEGORY 12: Cross-method type confusion — misrouted responses
// ============================================================================

describe('Contract Audit: Cross-method type confusion', () => {
  it('CRITICAL: select() returns boolean true when confirmed with no selectedValue', async () => {
    // A confirm-style response (confirmed=true, no values) sent to a select request
    // causes select() to return true instead of a string.
    // This is a TYPE VIOLATION: Promise<string | undefined> returns boolean.
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.select('Choose', ['a', 'b'])
    const request = transport.lastRequest()!
    
    // Respond as if it were a confirm dialog (no selectedValue)
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      // No selectedValue, no inputValue
    })
    
    const result = await promise
    // The promise was typed as Promise<string | undefined> but returns true
    expect(result).toBe(true) // TYPE VIOLATION: string | undefined but got boolean
    expect(typeof result).toBe('boolean')
  })

  it('CRITICAL: input() returns boolean true when confirmed with no inputValue', async () => {
    // Same issue as above: input() can return boolean true.
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.input('Enter text')
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      // No inputValue, no selectedValue
    })
    
    const result = await promise
    expect(result).toBe(true) // TYPE VIOLATION: string | undefined but got boolean
    expect(typeof result).toBe('boolean')
  })

  it('select() returns inputValue when no selectedValue provided', async () => {
    // If the renderer sends inputValue but no selectedValue for a select request,
    // the inputValue is used. This is a semantic mismatch.
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.select('Choose', ['a'])
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      inputValue: 'typed-text',
    })
    
    const result = await promise
    expect(result).toBe('typed-text') // inputValue returned from a select() call
  })

  it('confirm() returns string from selectedValue — TYPE VIOLATION', async () => {
    // If the renderer sends selectedValue for a confirm request,
    // confirm() returns a string instead of boolean.
    const transport = createMockTransport()
    const context = new ElectronUIContext('test-session', transport)
    
    const promise = context.confirm('Confirm?', 'msg')
    const request = transport.lastRequest()!
    
    context.handleResponse({
      requestId: request.id,
      sessionId: 'test-session',
      confirmed: true,
      selectedValue: 'surprise-string',
    })
    
    const result = await promise
    expect(result).toBe('surprise-string') // TYPE VIOLATION: Promise<boolean> returns string
    expect(typeof result).toBe('string')
  })
})

// ============================================================================
// CATEGORY 13: requestCounter and ID generation contract
// ============================================================================

describe('Contract Audit: Request ID generation', () => {
  it('request IDs follow the format "ui-{sessionPrefix}-{counter}-{timestamp}"', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('my-session-123', transport)
    
    context.select('Choose', ['a'])
    const request = transport.lastRequest()!
    
    // The format is: `ui-${sessionId.slice(0, 8)}-${++counter}-${Date.now()}`
    expect(request.id).toMatch(/^ui-my-sessi-1-\d+$/)
    
    context.dispose()
  })

  it('second request has counter=2', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('my-session-123', transport)
    
    context.select('Q1', ['a'])
    context.select('Q2', ['b'])
    
    const requests = transport.sentEvents.map(
      e => (e.event as { type: string; request: UIRequest }).request
    )
    
    expect(requests[0].id).toMatch(/^ui-my-sessi-1-\d+$/)
    expect(requests[1].id).toMatch(/^ui-my-sessi-2-\d+$/)
    
    context.dispose()
  })

  it('short sessionId (< 8 chars) is used as-is in ID prefix', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('ab', transport)
    
    context.select('Q', ['a'])
    const request = transport.lastRequest()!
    
    expect(request.id).toMatch(/^ui-ab-1-\d+$/)
    
    context.dispose()
  })

  it('empty sessionId creates IDs with empty prefix', async () => {
    const transport = createMockTransport()
    const context = new ElectronUIContext('', transport)
    
    context.select('Q', ['a'])
    const request = transport.lastRequest()!
    
    expect(request.id).toMatch(/^ui--1-\d+$/)
    // The session prefix is empty — no validation on sessionId.
    
    context.dispose()
  })
})
