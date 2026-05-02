import type { TextContent } from '@mariozechner/pi-ai'

/**
 * Extract plain text from a message content field.
 * Handles both string content and arrays of content blocks (TextContent, ToolCall, etc.).
 * Non-text blocks are silently filtered out.
 */
export function extractTextContent(
  content: string | Array<{ type: string }>,
): string {
  if (typeof content === 'string') return content
  return content
    .filter((block): block is TextContent => block.type === 'text')
    .map(block => block.text)
    .join('')
}
