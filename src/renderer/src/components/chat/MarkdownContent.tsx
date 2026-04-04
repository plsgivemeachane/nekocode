import React, { useState, useCallback, useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getSingletonHighlighter, type Highlighter } from 'shiki'

// ─── LRU Cache for highlighted HTML ───

const CACHE_MAX_ENTRIES = 500
const CACHE_MAX_BYTES = 50 * 1024 * 1024 // 50MB

function djb2Hash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff
  }
  return hash >>> 0
}

const htmlCache = new Map<string, { html: string; size: number }>()
let cacheTotalBytes = 0

function cacheGet(key: string): string | undefined {
  const entry = htmlCache.get(key)
  if (!entry) return undefined
  // Move to end (most recently used)
  htmlCache.delete(key)
  htmlCache.set(key, entry)
  return entry.html
}

function cacheSet(key: string, html: string): void {
  const size = new Blob([html]).size
  // Evict if over limits
  while (htmlCache.size > 0 && (htmlCache.size >= CACHE_MAX_ENTRIES || cacheTotalBytes + size > CACHE_MAX_BYTES)) {
    const firstKey = htmlCache.keys().next().value
    if (firstKey !== undefined) {
      const removed = htmlCache.get(firstKey)
      if (removed) cacheTotalBytes -= removed.size
      htmlCache.delete(firstKey)
    }
  }
  htmlCache.set(key, { html, size })
  cacheTotalBytes += size
}

function getCacheKey(code: string, lang: string): string {
  return `${djb2Hash(code)}:${code.length}:${lang}:github-dark`
}

// ─── Lazy Shiki Singleton ───

const highlighterPromise: Promise<Highlighter> = getSingletonHighlighter({
  themes: ['github-dark'],
  langs: ['typescript'],
})

const langLoadCache = new Map<string, Promise<void>>()

async function ensureLanguage(highlighter: Highlighter, lang: string): Promise<boolean> {
  const loaded = highlighter.getLoadedLanguages()
  // check exact match or alias
  if (loaded.includes(lang)) return true
  const cached = langLoadCache.get(lang)
  if (cached) {
    await cached
    return true
  }
  try {
    const promise = highlighter.loadLanguage(lang as import('shiki').BundledLanguage).then(() => {})
    langLoadCache.set(lang, promise)
    await promise
    return true
  } catch {
    return false
  }
}

// ─── Strip thinking tokens from model output ───

function stripThinkingTokens(content: string): string {
  return content
    // Remove entire lines containing <think>
    .replace(/^.*<think>.*$/gm, '')
    // Remove <details type="reasoning"> lines
    .replace(/^.*<details\s+type="reasoning".*$/gm, '')
    // Remove </details> lines
    .replace(/^.*<\/details>.*$/gm, '')
    // Remove lines starting with the thinking emoji (💭 U+1F4AD)
    .replace(/^💭.*$/gm, '')
    // Remove standalone "." lines that follow thinking blocks
    .replace(/^\.\s*$/gm, '')
    // Clean up excessive blank lines left behind (3+ newlines → 2)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── Extract plain text from React nodes ───

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement<{ children: React.ReactNode }>).props.children)
  }
  return ''
}

// ─── Copy Button (hover-reveal) ───

interface CopyButtonProps {
  text: string
}

function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="chat-markdown-copy-button"
      aria-label={copied ? 'Copied' : 'Copy code'}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
      )}
    </button>
  )
}

// ─── Code Block with Shiki highlighting ───

interface CodeBlockWithShikiProps {
  code: string
  language: string
}

function CodeBlockWithShiki({ code, language }: CodeBlockWithShikiProps) {
  const [html, setHtml] = useState<string>('')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const cacheKey = getCacheKey(code, language)
    const cached = cacheGet(cacheKey)
    if (cached) {
      setHtml(cached)
      return
    }
    highlighterPromise.then(async (highlighter) => {
      if (!mountedRef.current) return
      const langSupported = await ensureLanguage(highlighter, language)
      if (!mountedRef.current) return
      const result = highlighter.codeToHtml(code, {
        lang: langSupported ? language : 'text',
        theme: 'github-dark',
      })
      cacheSet(cacheKey, result)
      setHtml(result)
    })
    return () => {
      mountedRef.current = false
    }
  }, [code, language])

  if (!html) {
    return (
      <div className="code-block-container animate-fade-in">
        <CopyButton text={code} />
        <pre className="bg-surface-900 p-4 text-sm font-mono text-text-tertiary">
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className="code-block-container animate-fade-in">
      <CopyButton text={code} />
      <div
        className="shiki-wrapper"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

// ─── Code component (dispatches inline vs block) ───

interface CodeBlockProps {
  children: React.ReactNode
  className?: string
  node?: unknown
}

function CodeBlock({ children, className }: CodeBlockProps) {
  const codeString = extractText(children)
  const isInline = !className

  if (isInline) {
    return (
      <code>{children}</code>
    )
  }

  // Extract language from className (react-markdown passes "language-python")
  const language = className.replace(/^language-/, '') || 'text'

  return <CodeBlockWithShiki code={codeString} language={language} />
}

// ─── Main Markdown Content ───

interface MarkdownContentProps {
  content: string
}

export const MarkdownContent = React.memo(function MarkdownContent({ content }: MarkdownContentProps) {
  const cleaned = stripThinkingTokens(content)
  return (
    <div className="chat-markdown animate-fade-in">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ children, className }) => (
            <CodeBlock className={className}>{children}</CodeBlock>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Neutralize react-markdown's default <pre> wrapper since CodeBlock handles all styling
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {cleaned}
      </Markdown>
    </div>
  )
})
