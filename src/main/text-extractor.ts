import type { TextContent } from '@earendil-works/pi-ai'

/**
 * Extract plain text from a message content field.
 * Handles both string content and arrays of content blocks (TextContent, ToolCall, etc.).
 * Non-text blocks are silently filtered out.
 */
export function extractTextContent(
  content: string | Array<{ type: string }> | null | undefined,
): string {
  // Handle null/undefined content gracefully - return empty string
  if (content == null) return ''
  if (typeof content === 'string') return content
  return content
    .filter((block): block is TextContent => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Extract thinking/reasoning text from a message content field.
 * Handles arrays of content blocks and extracts ThinkingContent blocks.
 * Returns empty string if no thinking content is found.
 */
export function extractThinkingContent(
  content: string | Array<{ type: string }> | null | undefined,
): string {
  if (content == null) return ''
  if (typeof content === 'string') return ''
  return content
    .filter((block): block is { type: 'thinking'; thinking: string; redacted?: boolean } =>
      block.type === 'thinking' && !('redacted' in block && block.redacted))
    .map(block => block.thinking)
    .join('')
}
