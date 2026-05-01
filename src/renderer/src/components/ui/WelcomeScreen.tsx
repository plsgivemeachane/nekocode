import React, { useEffect, useState } from 'react'

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

interface Tip {
  icon: string
  title: string
  description: string
}

const TIPS: Tip[] = [
  // Nekocode-specific tips
  {
    icon: '\u{1F4C2}',
    title: 'Multi-file changes',
    description: 'Nekocode can edit multiple files in one request. Just describe all the changes you need across your project.',
  },
  {
    icon: '\u{1F50D}',
    title: 'Search the codebase',
    description: 'Ask Nekocode to "find where X is used" or "search for Y pattern" to explore unfamiliar code quickly.',
  },
  {
    icon: '\u{1F4CB}',
    title: 'Paste errors directly',
    description: 'Paste error messages, stack traces, or terminal output. Nekocode will analyze and fix the root cause.',
  },
  {
    icon: '\u{1F4A1}',
    title: 'Explain before editing',
    description: 'Ask "explain this code" before requesting changes. Understanding leads to better modifications.',
  },
  {
    icon: '\u{1F527}',
    title: 'Iterative refinement',
    description: 'Don\u2019t like the first result? Ask for alternatives, adjustments, or a different approach. Refine until it fits.',
  },
  {
    icon: '\u{1F4DD}',
    title: 'Context is king',
    description: 'Mention file paths, function names, or paste relevant code. More context means more accurate responses.',
  },
  {
    icon: '\u{1F4CA}',
    title: 'Complex refactors',
    description: 'Nekocode excels at large-scale refactors. Describe the pattern change and it will apply it consistently.',
  },
  {
    icon: '\u{1F680}',
    title: 'Quick scaffolding',
    description: 'Need a new component, module, or feature? Describe it and Nekocode will scaffold the boilerplate.',
  },
  {
    icon: '\u{1F9EA}',
    title: 'Write tests together',
    description: 'Ask Nekocode to write tests while you implement. It knows your codebase and can generate meaningful test cases.',
  },
  {
    icon: '\u{1F4DA}',
    title: 'Learn as you go',
    description: 'Ask "why did you do it this way?" to understand the reasoning behind Nekocode\u2019s suggestions.',
  },
  // Keyboard shortcut tips
  {
    icon: '\u{2328}\uFE0F',
    title: 'Quick new session',
    description: 'Press Ctrl+K to start a fresh session instantly. No clicking required.',
  },
  {
    icon: '\u{2328}\uFE0F',
    title: 'Restore last session',
    description: 'Accidentally closed? Ctrl+Shift+K restores your previous session context.',
  },
  {
    icon: '\u{2328}\uFE0F',
    title: 'Toggle the sidebar',
    description: 'Press Ctrl+B to show/hide the sidebar. More screen space for your code.',
  },
  {
    icon: '\u{2328}\uFE0F',
    title: 'Abort streaming',
    description: 'Response going off track? Press Escape to stop generation immediately.',
  },
  {
    icon: '\u{2328}\uFE0F',
    title: 'Multi-line input',
    description: 'Need a longer prompt? Shift+Enter adds a new line instead of sending.',
  },
  {
    icon: '\u{2328}\uFE0F',
    title: 'Zoom controls',
    description: 'Ctrl+plus/minus to zoom, Ctrl+0 to reset. Adjust text size to your preference.',
  },
  // Workflow tips
  {
    icon: '\u{1F5C2}\uFE0F',
    title: 'Session history',
    description: 'Each session saves its messages. Browse past conversations from the sidebar anytime.',
  },
  {
    icon: '\u{1F4C1}',
    title: 'Multiple projects',
    description: 'Open different folders as separate projects. Switch between them from the sidebar.',
  },
  {
    icon: '\u{1F310}',
    title: 'Web search available',
    description: 'Nekocode can search the web for documentation, solutions, and latest library updates.',
  },
  {
    icon: '\u{26A1}',
    title: 'Parallel tasks',
    description: 'Nekocode can run multiple tools in parallel. It will batch independent operations automatically.',
  },
  {
    icon: '\u{1F4AC}',
    title: 'Ask for alternatives',
    description: 'Not sure about the best approach? Ask "what are the options?" to compare different solutions.',
  },
  {
    icon: '\u{1F3AF}',
    title: 'Be specific',
    description: '"Fix the bug" is vague. "Fix the null pointer in UserService.ts line 42" gets precise results.',
  },
  {
    icon: '\u{1F504}',
    title: 'Undo with git',
    description: 'Nekocode uses git for safety. If something goes wrong, you can always revert.',
  },
  {
    icon: '\u{1F331}',
    title: 'Start small',
    description: 'Break large tasks into smaller steps. Incremental changes are easier to review and debug.',
  },
]

interface Shortcut {
  keys: string[]
  description: string
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'K'], description: 'New session' },
  { keys: ['Ctrl', 'Shift', 'K'], description: 'Restore last session' },
  { keys: ['Ctrl', 'B'], description: 'Toggle sidebar' },
  { keys: ['Ctrl', '='], description: 'Zoom in' },
  { keys: ['Ctrl', '-'], description: 'Zoom out' },
  { keys: ['Ctrl', '0'], description: 'Reset zoom' },
  { keys: ['Enter'], description: 'Send message' },
  { keys: ['Shift', 'Enter'], description: 'New line' },
  { keys: ['Escape'], description: 'Abort stream' },
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

function useRotatingTip(intervalMs: number = 6000) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * TIPS.length))
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % TIPS.length)
        setVisible(true)
      }, 400)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return { tip: TIPS[index], visible }
}

export function WelcomeScreen() {
  const { quote, visible: quoteVisible } = useRotatingQuote()
  const { tip, visible: tipVisible } = useRotatingTip()

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
      <p className="text-[#9CA3AF] text-sm mb-10">
        Your coding agent, ready to build.
      </p>

      {/* Quote */}
      <div
        className={`max-w-md text-center mb-8 transition-all duration-400 ease-out-expo ${
          quoteVisible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-1'
        }`}
      >
        <blockquote className="text-[#B0B8C4] text-sm leading-relaxed italic mb-2">
          &ldquo;{quote.text}&rdquo;
        </blockquote>
        <cite className="text-[#9CA3AF] text-xs not-italic">&mdash; {quote.author}</cite>
      </div>

      {/* Rotating Tip */}
      <div className="max-w-md w-full px-4 mb-10">
        <h2 className="text-text-primary text-sm font-medium mb-4 text-center">Tip for Nekocode</h2>
        <div
          className={`flex items-start gap-3 px-4 py-3 rounded-xl bg-surface-900/60 border border-surface-800/50 transition-all duration-400 ease-out-expo ${
            tipVisible
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-1'
          }`}
        >
          <span className="text-lg leading-none mt-0.5">{tip.icon}</span>
          <div>
            <div className="text-text-primary text-sm font-medium mb-0.5">{tip.title}</div>
            <div className="text-[#9CA3AF] text-xs leading-relaxed">{tip.description}</div>
          </div>
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="max-w-lg w-full px-4">
        <h2 className="text-text-primary text-sm font-medium mb-4 text-center">Keyboard Shortcuts</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.description} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-xs text-[#9CA3AF]">{s.description}</span>
              <div className="flex items-center gap-1 shrink-0">
                {s.keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 text-[10px] leading-none font-mono text-[#C9CED6] bg-surface-800/80 border border-surface-600/50 rounded"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
