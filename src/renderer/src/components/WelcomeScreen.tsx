import React, { useEffect, useState, useCallback } from 'react'

const QUOTES = [
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
  { text: 'Code is like humor. When you have to explain it, it\u2019s bad.', author: 'Cory House' },
  { text: 'Simplicity is the soul of efficiency.', author: 'Austin Freeman' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { text: 'The best error message is the one that never shows up.', author: 'Thomas Fuchs' },
  { text: 'Any fool can write code that a computer can understand. Good programmers write code that humans can understand.', author: 'Martin Fowler' },
  { text: 'Programming isn\u2019t about what you know; it\u2019s about what you can figure out.', author: 'Chris Pine' },
  { text: 'The only way to learn a new programming language is by writing programs in it.', author: 'Dennis Ritchie' },
  { text: 'Sometimes it pays to stay in bed on Monday, rather than spending the rest of the week debugging Monday\u2019s code.', author: 'Dan Salomon' },
  { text: 'Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.', author: 'Antoine de Saint-Exup\u00e9ry' },
]

interface Suggestion {
  svg: React.ReactNode
  label: string
  prompt: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    svg: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    label: 'Explain codebase',
    prompt: 'Explain the architecture and structure of this project',
  },
  {
    svg: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    ),
    label: 'Fix a bug',
    prompt: 'Help me debug an issue I\'m seeing',
  },
  {
    svg: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6M10 22h4M12 2v1M4.22 4.22l.71.71M1 12h1M21 12h1M18.36 4.22l-.71.71M16 10a4 4 0 10-8 0c0 2 2 3 2 6h4c0-3 2-4 2-6z" />
      </svg>
    ),
    label: 'Add a feature',
    prompt: 'I want to add a new feature',
  },
  {
    svg: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
    label: 'Refactor',
    prompt: 'Help me refactor this code for better maintainability',
  },
  {
    svg: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
      </svg>
    ),
    label: 'Write tests',
    prompt: 'Write tests for the existing code',
  },
  {
    svg: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
    label: 'Optimize',
    prompt: 'Help me optimize performance bottlenecks',
  },
]

interface Shortcut {
  keys: string[]
  description: string
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'K'], description: 'New session' },
  { keys: ['Enter'], description: 'Send' },
  { keys: ['Shift', 'Enter'], description: 'New line' },
]

function useRotatingQuote(intervalMs: number = 8000) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * QUOTES.length))
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % QUOTES.length)
        setVisible(true)
      }, 400)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return { quote: QUOTES[index], visible }
}

interface WelcomeScreenProps {
  onSuggestionClick?: (prompt: string) => void
}

export function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  const { quote, visible } = useRotatingQuote()

  const handleClick = useCallback(
    (prompt: string) => {
      onSuggestionClick?.(prompt)
    },
    [onSuggestionClick],
  )

  return (
    <div className="flex flex-col items-center justify-center h-full select-none pt-16">
      {/* Logo */}
      <div className="relative mb-6">
        <div className="w-14 h-14 rounded-xl bg-surface-900/80 border border-surface-700/50 flex items-center justify-center overflow-hidden">
          <img
            src="./favicon.png"
            alt="nekocode"
            className="w-10 h-10 object-contain"
          />
        </div>
      </div>

      {/* Title */}
      <h1 className="text-text-primary text-lg font-semibold tracking-tight mb-1.5 font-mono">
        nekocode
      </h1>
      <p className="text-[#9CA3AF] text-sm mb-12">
        Your coding agent, ready to build.
      </p>

      {/* Quote */}
      <div
        className={`max-w-md text-center mb-12 transition-all duration-400 ease-out-expo ${
          visible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-1'
        }`}
      >
        <blockquote className="text-[#B0B8C4] text-sm leading-relaxed italic mb-2">
          &ldquo;{quote.text}&rdquo;
        </blockquote>
        <cite className="text-[#9CA3AF] text-xs not-italic">&mdash; {quote.author}</cite>
      </div>

      {/* Suggestion chips */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-12 max-w-lg w-full px-4">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => handleClick(s.prompt)}
            className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface-900/80 border border-surface-800 hover:border-accent-500/30 hover:bg-surface-850 text-left transition-all duration-200 cursor-pointer"
          >
            <span className="text-[#9CA3AF] group-hover:text-accent-400 transition-colors duration-200 flex-shrink-0">
              {s.svg}
            </span>
            <span className="text-[#B0B8C4] group-hover:text-text-primary text-sm transition-colors duration-200">
              {s.label}
            </span>
          </button>
        ))}
      </div>

      {/* Keyboard shortcuts */}
      <div className="flex items-center gap-5 text-[#9CA3AF]">
        {SHORTCUTS.map((s, i) => (
          <div key={s.description} className="flex items-center gap-2">
            {i > 0 && <span className="text-[#3B3F48] mx-1.5">|</span>}
            <div className="flex items-center gap-1">
              {s.keys.map((key) => (
                <kbd
                  key={key}
                  className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 text-[11px] leading-none font-mono text-[#C9CED6] bg-surface-800/80 border border-surface-600/50 rounded-md"
                >
                  {key}
                </kbd>
              ))}
            </div>
            <span className="text-xs text-[#9CA3AF]">{s.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
