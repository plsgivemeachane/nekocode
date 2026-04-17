import { describe, it, expect } from 'vitest'
import { extractTextContent } from '../main/text-extractor'

describe('extractTextContent', () => {
  it('returns string content as-is', () => {
    expect(extractTextContent('hello world')).toBe('hello world')
  })

  it('returns empty string as-is', () => {
    expect(extractTextContent('')).toBe('')
  })

  it('extracts text from a single TextContent block', () => {
    expect(extractTextContent([{ type: 'text', text: 'hello' }] as unknown as Parameters<typeof extractTextContent>[0])).toBe('hello')
  })

  it('joins text from multiple TextContent blocks', () => {
    const blocks = [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }]
    expect(extractTextContent(blocks)).toBe('hello world')
  })

  it('filters out non-text blocks', () => {
    const blocks = [
      { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: '{}' },
      { type: 'text', text: 'visible' },
      { type: 'toolResult', toolCallId: 'tc-1', result: 'ok' },
    ]
    expect(extractTextContent(blocks)).toBe('visible')
  })

  it('returns empty string for array with only non-text blocks', () => {
    const blocks = [
      { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: '{}' },
      { type: 'toolResult', toolCallId: 'tc-1', result: 'ok' },
    ]
    expect(extractTextContent(blocks)).toBe('')
  })

  it('returns empty string for empty array', () => {
    expect(extractTextContent([])).toBe('')
  })

  it('handles mixed text and non-text blocks', () => {
    const blocks = [
      { type: 'text', text: 'before ' },
      { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: '{}' },
      { type: 'text', text: 'after' },
    ]
    expect(extractTextContent(blocks)).toBe('before after')
  })
})
