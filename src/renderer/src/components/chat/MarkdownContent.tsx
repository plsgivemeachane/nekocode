import React, { useState, useCallback } from 'react'
import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'

interface CopyButtonProps {
  text: string
}

function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-0.5 text-xs text-text-tertiary hover:text-text-primary bg-surface-800 hover:bg-surface-700 rounded transition-colors duration-200"
      aria-label="Copy code"
    >
      {copied ? '✓' : 'Copy'}
    </button>
  )
}

interface CodeBlockProps {
  children: React.ReactNode
  className?: string
}

function CodeBlock({ children, className }: CodeBlockProps) {
  const codeString = extractText(children)
  const isInline = !className

  if (isInline) {
    return (
      <code className="bg-surface-800 px-1.5 py-0.5 rounded text-sm font-mono text-accent-400">
        {children}
      </code>
    )
  }

  return (
    <div className="relative group">
      <CopyButton text={codeString} />
      <pre className="bg-surface-900 rounded-lg p-4 overflow-x-auto text-sm font-mono text-text-primary border border-surface-850">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement).props.children)
  }
  return ''
}

interface MarkdownContentProps {
  content: string
}

export const MarkdownContent = React.memo(function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-pre:p-0 prose-pre:bg-transparent prose-code:before:content-none prose-code:after:content-none animate-fade-in">
      <Markdown
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: ({ children, className, ...rest }) => (
            <CodeBlock className={className}>{children}</CodeBlock>
          ),
          a: ({ href, children, ...rest }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-text-accent hover:text-accent-300 underline underline-offset-2">
              {children}
            </a>
          ),
          pre: ({ children, ...rest }) => (
            <pre className="bg-surface-900 rounded-lg max-h-96 overflow-y-auto p-0 border border-surface-850" {...rest}>
              {children}
            </pre>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  )
})
