import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-logs') },
}))

import {
  createSdkSession,
  createResourceLoader,
  shouldRetryWithoutExtensions,
  normalizeExtensionErrors,
  logExtensionErrors,
  loadWithFallback,
} from '../main/extension-loader'
import type { ExtensionLoadError } from '../shared/ipc-types'

type SdkSessionManagerMock = never

const mockState = vi.hoisted(() => {
  const loaderCtorCalls: Array<{ cwd: string; agentDir: string; settingsManager: unknown; noExtensions?: boolean }> = []
  const loaderReloadMock = vi.fn(async () => {})
  const mockCreateAgentSession = vi.fn<() => Promise<{ session: { sessionId: string }; extensionsResult: { extensions: Array<{ path: string }>; errors: unknown[] } }>>()
  const mockGetAgentDir = vi.fn(() => '/fake/agent/dir')
  const mockSettingsCreate = vi.fn(() => ({ kind: 'settings' }))
  return { loaderCtorCalls, loaderReloadMock, mockCreateAgentSession, mockGetAgentDir, mockSettingsCreate }
})

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: mockState.mockCreateAgentSession,
  DefaultResourceLoader: class MockDefaultResourceLoader {
    constructor(config: { cwd: string; agentDir: string; settingsManager: unknown; noExtensions?: boolean }) {
      mockState.loaderCtorCalls.push(config)
    }
    reload = mockState.loaderReloadMock
  },
  getAgentDir: mockState.mockGetAgentDir,
  SettingsManager: { create: mockState.mockSettingsCreate },
}))

describe('createSdkSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.loaderCtorCalls.length = 0
  })

  it('creates an SDK session with default options', async () => {
    const mockSession = { sessionId: 'test-session' }
    mockState.mockCreateAgentSession.mockResolvedValue({
      session: mockSession,
      extensionsResult: { extensions: [], errors: [] },
    })
    const result = await createSdkSession({} as SdkSessionManagerMock, '/cwd', 'create')
    expect(result.session).toBe(mockSession)
    expect(result.extensionsResult.extensions).toEqual([])
    expect(mockState.loaderCtorCalls).toHaveLength(1)
    expect(mockState.loaderCtorCalls[0]).toMatchObject({
      cwd: '/cwd',
      agentDir: '/fake/agent/dir',
      noExtensions: undefined,
    })
    expect(mockState.loaderReloadMock).toHaveBeenCalled()
    expect(mockState.mockCreateAgentSession).toHaveBeenCalledWith({
      cwd: '/cwd',
      resourceLoader: expect.any(Object),
      sessionManager: {},
    })
  })

  it('passes noExtensions option to resource loader', async () => {
    mockState.mockCreateAgentSession.mockResolvedValue({
      session: { sessionId: 's1' },
      extensionsResult: { extensions: [], errors: [] },
    })
    await createSdkSession({} as SdkSessionManagerMock, '/cwd', 'create-noext', { noExtensions: true })
    expect(mockState.loaderCtorCalls[0].noExtensions).toBe(true)
  })

  it('uses correct mode string in debug log', async () => {
    mockState.mockCreateAgentSession.mockResolvedValue({
      session: { sessionId: 's1' },
      extensionsResult: { extensions: [], errors: [] },
    })
    await createSdkSession({} as SdkSessionManagerMock, '/cwd', 'reconnect')
    expect(mockState.mockCreateAgentSession).toHaveBeenCalled()
  })
})

describe('createResourceLoader', () => {
  beforeEach(() => {
    mockState.loaderCtorCalls.length = 0
  })
  it('creates a DefaultResourceLoader with correct parameters', () => {
    const loader = createResourceLoader('/my/cwd')
    expect(mockState.loaderCtorCalls).toHaveLength(1)
    expect(mockState.loaderCtorCalls[0]).toMatchObject({
      cwd: '/my/cwd',
      agentDir: '/fake/agent/dir',
      noExtensions: undefined,
    })
    expect(loader.reload).toBe(mockState.loaderReloadMock)
  })

  it('passes noExtensions when provided', () => {
    createResourceLoader('/my/cwd', { noExtensions: true })
    expect(mockState.loaderCtorCalls[0].noExtensions).toBe(true)
  })
})

describe('shouldRetryWithoutExtensions', () => {
  it('returns false when extensions were loaded successfully', () => {
    expect(shouldRetryWithoutExtensions([], 3)).toBe(false)
  })

  it('returns false when there are no errors', () => {
    expect(shouldRetryWithoutExtensions([], 0)).toBe(false)
  })

  it('returns false when errors have different messages', () => {
    const errors: ExtensionLoadError[] = [
      { path: '/a', message: '(void 0) is not a function' },
      { path: '/b', message: 'different error' },
    ]
    expect(shouldRetryWithoutExtensions(errors, 0)).toBe(false)
  })

  it('returns false when single error message does not contain the signature', () => {
    const errors: ExtensionLoadError[] = [
      { path: '/a', message: 'some other error' },
      { path: '/b', message: 'some other error' },
    ]
    expect(shouldRetryWithoutExtensions(errors, 0)).toBe(false)
  })

  it('returns true when all errors have same message with (void 0) signature', () => {
    const errors: ExtensionLoadError[] = [
      { path: '/a', message: 'TypeError: (void 0) is not a function' },
      { path: '/b', message: 'TypeError: (void 0) is not a function' },
    ]
    expect(shouldRetryWithoutExtensions(errors, 0)).toBe(true)
  })

  it('returns false when loadedExtensionsCount > 0 even with matching error signature', () => {
    const errors: ExtensionLoadError[] = [
      { path: '/a', message: '(void 0) is not a function' },
    ]
    expect(shouldRetryWithoutExtensions(errors, 1)).toBe(false)
  })

  it('returns false when errors have undefined message (triggers ?? "" fallback)', () => {
    const errors = [{ path: '/a' } as ExtensionLoadError]
    expect(shouldRetryWithoutExtensions(errors, 0)).toBe(false)
  })
})

describe('normalizeExtensionErrors', () => {
  it('handles string errors', () => {
    const result = normalizeExtensionErrors(['error one', 'error two'])
    expect(result).toEqual([
      { path: 'unknown:0', message: 'error one' },
      { path: 'unknown:1', message: 'error two' },
    ])
  })

  it('handles object errors with path, error, and stack', () => {
    const result = normalizeExtensionErrors([
      { path: '/ext/a.ts', error: 'load failed', stack: 'at line 1' },
    ])
    expect(result).toEqual([
      { path: '/ext/a.ts', message: 'load failed', stack: 'at line 1' },
    ])
  })

  it('handles object errors with message instead of error key', () => {
    const result = normalizeExtensionErrors([
      { path: '/ext/b.ts', message: 'msg error' },
    ])
    expect(result).toEqual([
      { path: '/ext/b.ts', message: 'msg error', stack: undefined },
    ])
  })

  it('handles object error with non-string error key - falls through to message key', () => {
    const result = normalizeExtensionErrors([
      { path: '/ext/c.ts', error: 123, message: 'fallback msg' },
    ])
    expect(result).toEqual([
      { path: '/ext/c.ts', message: 'fallback msg', stack: undefined },
    ])
  })

  it('handles object error with no string error or message - uses String(error)', () => {
    const result = normalizeExtensionErrors([
      { path: '/ext/d.ts' },
    ])
    expect(result).toEqual([
      { path: '/ext/d.ts', message: String({ path: '/ext/d.ts' }), stack: undefined },
    ])
  })

  it('handles object errors without path field', () => {
    const result = normalizeExtensionErrors([
      { error: 'no path' },
    ])
    expect(result).toEqual([
      { path: 'unknown:0', message: 'no path', stack: undefined },
    ])
  })

  it('handles non-string non-object errors (number)', () => {
    const result = normalizeExtensionErrors([42])
    expect(result).toEqual([
      { path: 'unknown:0', message: '42' },
    ])
  })

  it('handles null error', () => {
    const result = normalizeExtensionErrors([null])
    expect(result).toEqual([
      { path: 'unknown:0', message: 'null' },
    ])
  })

  it('handles mixed error types', () => {
    const result = normalizeExtensionErrors([
      'string error',
      { path: '/a.ts', error: 'obj error', stack: 'stack trace' },
      99,
    ])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ path: 'unknown:0', message: 'string error' })
    expect(result[1]).toEqual({ path: '/a.ts', message: 'obj error', stack: 'stack trace' })
    expect(result[2]).toEqual({ path: 'unknown:2', message: '99' })
  })

  it('handles object with non-string stack field', () => {
    const result = normalizeExtensionErrors([
      { path: '/e.ts', error: 'err', stack: 12345 },
    ])
    expect(result[0].stack).toBeUndefined()
  })
})

describe('logExtensionErrors', () => {
  it('does nothing for empty errors array', () => {
    logExtensionErrors('create', [])
  })

  it('logs marker-only errors as warnings', () => {
    const errors: ExtensionLoadError[] = [
      { path: '__create__', message: 'Create fallback engaged' },
    ]
    logExtensionErrors('create', errors)
  })

  it('logs marker-only errors with __reconnect__ path as warnings', () => {
    const errors: ExtensionLoadError[] = [
      { path: '__reconnect__', message: 'Reconnect fallback engaged' },
    ]
    logExtensionErrors('reconnect', errors)
  })

  it('logs real errors with fingerprint detection when all have same message', () => {
    const errors: ExtensionLoadError[] = [
      { path: '/a.ts', message: 'same error', stack: undefined },
      { path: '/b.ts', message: 'same error', stack: undefined },
    ]
    logExtensionErrors('create', errors)
  })

  it('logs real errors without fingerprint when messages differ', () => {
    const errors: ExtensionLoadError[] = [
      { path: '/a.ts', message: 'error a', stack: undefined },
      { path: '/b.ts', message: 'error b', stack: undefined },
    ]
    logExtensionErrors('create', errors)
  })

  it('logs diagnostic message when no stacks are provided', () => {
    const errors: ExtensionLoadError[] = [
      { path: '/a.ts', message: 'no stack error' },
    ]
    logExtensionErrors('create', errors)
  })

  it('logs stack traces when present', () => {
    const errors: ExtensionLoadError[] = [
      { path: '/a.ts', message: 'with stack', stack: 'Error at line 1\nat line 2' },
    ]
    logExtensionErrors('create', errors)
  })

  it('handles mixed errors - some with stacks, some without', () => {
    const errors: ExtensionLoadError[] = [
      { path: '/a.ts', message: 'has stack', stack: 'trace' },
      { path: '/b.ts', message: 'no stack' },
    ]
    logExtensionErrors('reconnect', errors)
  })
})

describe('loadWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeSuccessfulResult = (sessionId = 'sess-1', extensions: Array<{ path: string }> = []) => ({
    session: { sessionId },
    extensionsResult: { extensions, errors: [] },
  })

  it('returns primary result when no extension errors', async () => {
    const result = makeSuccessfulResult()
    mockState.mockCreateAgentSession.mockResolvedValue(result)
    const out = await loadWithFallback('create', () => ({} as SdkSessionManagerMock), '/cwd', false)
    expect(out.session.sessionId).toBe('sess-1')
    expect(out.extensionErrors).toEqual([])
    expect(out.extensionsDisabled).toBe(false)
  })

  it('returns primary result when errors do not match systemic signature', async () => {
    mockState.mockCreateAgentSession.mockResolvedValue({
      session: { sessionId: 's1' },
      extensionsResult: { extensions: [], errors: ['random error'] },
    })
    const out = await loadWithFallback('create', () => ({} as SdkSessionManagerMock), '/cwd', false)
    expect(out.session.sessionId).toBe('s1')
    expect(out.extensionErrors).toEqual([{ path: 'unknown:0', message: 'random error' }])
  })

  it('throws when systemic signature detected but fallback not allowed', async () => {
    mockState.mockCreateAgentSession.mockResolvedValue({
      session: { sessionId: 's1' },
      extensionsResult: {
        extensions: [],
        errors: [
          { path: '/a.ts', error: '(void 0) is not a function' },
          { path: '/b.ts', error: '(void 0) is not a function' },
        ],
      },
    })
    await expect(
      loadWithFallback('create', () => ({} as SdkSessionManagerMock), '/cwd', false),
    ).rejects.toThrow('Systemic extension loader failure')
  })

  it('falls back successfully when systemic signature and fallback allowed', async () => {
    const primaryResult = {
      session: { sessionId: 's1' },
      extensionsResult: {
        extensions: [],
        errors: [
          { path: '/a.ts', error: '(void 0) is not a function' },
          { path: '/b.ts', error: '(void 0) is not a function' },
        ],
      },
    }
    const fallbackResult = makeSuccessfulResult('s1-fallback')
    let callCount = 0
    mockState.mockCreateAgentSession.mockImplementation(async () => {
      callCount++
      return callCount === 1 ? primaryResult : fallbackResult
    })
    const out = await loadWithFallback('create', () => ({} as SdkSessionManagerMock), '/cwd', true)
    expect(out.session.sessionId).toBe('s1-fallback')
    expect(out.extensionsDisabled).toBe(true)
    expect(out.extensionErrors).toHaveLength(1)
    expect(out.extensionErrors[0].path).toBe('__create__')
    expect(mockState.mockCreateAgentSession).toHaveBeenCalledTimes(2)
  })

  it('falls back but also fails - merges errors', async () => {
    const primaryResult = {
      session: { sessionId: 's1' },
      extensionsResult: {
        extensions: [],
        errors: [
          { path: '/a.ts', error: '(void 0) is not a function' },
        ],
      },
    }
    const fallbackResult = {
      session: { sessionId: 's1-retry' },
      extensionsResult: {
        extensions: [],
        errors: ['still broken'],
      },
    }
    let callCount = 0
    mockState.mockCreateAgentSession.mockImplementation(async () => {
      callCount++
      return callCount === 1 ? primaryResult : fallbackResult
    })
    const out = await loadWithFallback('reconnect', () => ({} as SdkSessionManagerMock), '/cwd', true)
    expect(out.extensionsDisabled).toBe(false)
    expect(out.extensionErrors.length).toBe(3)
    expect(out.extensionErrors[2].path).toBe('__reconnect__')
    expect(out.extensionErrors[2].message).toContain('fallback attempted')
  })

  it('logs loaded extensions in success path', async () => {
    mockState.mockCreateAgentSession.mockResolvedValue({
      session: { sessionId: 's1' },
      extensionsResult: {
        extensions: [{ path: '/ext/a.ts' }, { path: '/ext/b.ts' }],
        errors: [],
      },
    })
    await loadWithFallback('create', () => ({} as SdkSessionManagerMock), '/cwd', true)
    expect(mockState.mockCreateAgentSession).toHaveBeenCalledTimes(1)
  })

  it('uses reconnect mode in fallback marker path', async () => {
    const primaryResult = {
      session: { sessionId: 's1' },
      extensionsResult: {
        extensions: [],
        errors: [
          { path: '/a.ts', error: '(void 0) is not a function' },
        ],
      },
    }
    const fallbackResult = makeSuccessfulResult('s1-fallback')
    let callCount = 0
    mockState.mockCreateAgentSession.mockImplementation(async () => {
      callCount++
      return callCount === 1 ? primaryResult : fallbackResult
    })
    const out = await loadWithFallback('reconnect', () => ({} as SdkSessionManagerMock), '/cwd', true)
    expect(out.extensionErrors[0].path).toBe('__reconnect__')
  })

  it('calls getSdkSessionManager factory twice when fallback is needed', async () => {
    const primaryResult = {
      session: { sessionId: 's1' },
      extensionsResult: {
        extensions: [],
        errors: [
          { path: '/a.ts', error: '(void 0) is not a function' },
        ],
      },
    }
    const fallbackResult = makeSuccessfulResult('s1-fallback')
    const factory = vi.fn(() => ({} as SdkSessionManagerMock))
    let callCount = 0
    mockState.mockCreateAgentSession.mockImplementation(async () => {
      callCount++
      return callCount === 1 ? primaryResult : fallbackResult
    })
    await loadWithFallback('create', factory, '/cwd', true)
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
