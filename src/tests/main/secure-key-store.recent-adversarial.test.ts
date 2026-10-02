import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageState = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => Buffer.from(value === 'access-secret' ? 'a1b2c3' : 'd4e5f6', 'hex')),
  decrypt: vi.fn((value: Buffer) => `clear:${value.toString('utf8')}`),
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: storageState.encrypt,
    decryptString: storageState.decrypt,
  },
}))

import { decryptAuthJson, encryptAuthJson } from '@/main/secure-key-store'

beforeEach(() => {
  storageState.encrypt.mockClear()
  storageState.decrypt.mockReset()
  storageState.decrypt.mockImplementation((value: Buffer) => `clear:${value.toString('utf8')}`)
})

describe('secure auth storage adversarial cases from SDK 0.99.2 migration', () => {
  it('wraps both OAuth tokens in the protected storage format while preserving metadata', () => {
    const encoded = JSON.parse(encryptAuthJson(JSON.stringify({
      provider: { type: 'oauth', access: 'access-secret', refresh: 'refresh-secret', expires: 42 },
    })))

    expect(encoded.provider.access).toMatch(/^enc:v1:/)
    expect(encoded.provider.refresh).toMatch(/^enc:v1:/)
    expect(storageState.encrypt.mock.calls).toEqual([['access-secret'], ['refresh-secret']])
    expect(encoded.provider.access).toBe('enc:v1:obLD')
    expect(encoded.provider.refresh).toBe('enc:v1:1OX2')
    expect(encoded.provider.expires).toBe(42)
    expect(encoded.provider.access).not.toContain('access-secret')
    expect(encoded.provider.refresh).not.toContain('refresh-secret')
  })

  it('removes only the credential whose OAuth access token cannot be decrypted', () => {
    storageState.decrypt.mockImplementation((value: Buffer) => {
      if (value.toString('utf8') === 'broken') throw new Error('keychain failure')
      return `clear:${value.toString('utf8')}`
    })

    const result = JSON.parse(decryptAuthJson(JSON.stringify({
      broken: { type: 'oauth', access: 'enc:v1:YnJva2Vu', refresh: 'enc:v1:b2s=' },
      healthy: { type: 'api_key', key: 'enc:v1:aGVhbHRoeQ==' },
    })))

    expect(result.broken).toBeUndefined()
    expect(result.healthy).toEqual({ type: 'api_key', key: 'clear:healthy' })
  })

  it('removes only the credential whose OAuth refresh token cannot be decrypted', () => {
    storageState.decrypt.mockImplementation((value: Buffer) => {
      if (value.toString('utf8') === 'broken-refresh') throw new Error('keychain failure')
      return `clear:${value.toString('utf8')}`
    })

    const result = JSON.parse(decryptAuthJson(JSON.stringify({
      broken: { type: 'oauth', access: 'enc:v1:b2s=', refresh: 'enc:v1:YnJva2VuLXJlZnJlc2g=' },
      healthy: { type: 'oauth', access: 'enc:v1:b2s=', refresh: 'enc:v1:b2s=' },
    })))

    expect(result.broken).toBeUndefined()
    expect(result.healthy).toEqual({ type: 'oauth', access: 'clear:ok', refresh: 'clear:ok' })
  })

  it('preserves malformed auth content so a transient storage failure cannot erase it', () => {
    const malformed = '{"provider":'
    expect(decryptAuthJson(malformed)).toBe(malformed)
    expect(encryptAuthJson(malformed)).toBe(malformed)
  })
})
