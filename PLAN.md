# Apply T3 Code Rendering Pipeline

## Context

NekoCode's chat markdown rendering currently uses `highlight.js` + `rehype-highlight` for syntax highlighting, with a basic always-visible copy button and no language label. The `MARKDOWN_BREAKDOWN.md` spec describes T3Code's production-grade approach: **Shiki** for highlighting, theme-bridged backgrounds, hover-reveal copy button with language label header, GFM support, and completion dividers between turns. This plan upgrades the rendering to match that quality bar.

**Current state:**
- `react-markdown` v10.1.0 + `rehype-highlight` + `highlight.js`
- Copy button: always visible, top-right absolute positioned, no language label
- No `remark-gfm` (tables, task lists, strikethrough won't render)
- No completion dividers between chat turns
- Inline code uses `bg-surface-800` -- fine, but no explicit font-size normalization
- Code blocks use `bg-surface-900` with `border border-surface-850`

**Target state (T3):**
- `shiki` for syntax highlighting (replaces highlight.js + rehype-highlight)
- Code block header bar: language label (left) + hover-reveal copy button (right)
- Theme-bridged background using existing surface design tokens
- `remark-gfm` for full GFM support
- CSS: `tab-size: 2`, `cursor: text`, consistent line-height, scroll handling

## Approach

Replace the syntax highlighting pipeline (highlight.js → shiki), restructure the `CodeBlock` component to include a header bar with language label and hover-reveal copy, add `remark-gfm`. Keep all styling within the existing Tailwind + CSS custom property system — no new color tokens needed.

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `shiki`, `remark-gfm`. Remove `highlight.js`, `rehype-highlight` |
| `src/renderer/src/index.css` | Remove `@import "highlight.js/..."`. Remove `.hljs` overrides. Add `.shiki` base styles, code block CSS, completion divider gradient styles |
| `src/renderer/src/components/chat/MarkdownContent.tsx` | **Major rewrite**: Replace `rehype-highlight` plugin with a custom Shiki-based `code` component. Add header bar to `CodeBlock`. Make copy button hover-reveal. Add language label. Update inline code styling. Add `remark-gfm` to plugins |

| `bun.lock` / `package-lock.json` | Regenerated after dependency changes (via `bun install`) |

## Reuse

- **`extractText()`** in `MarkdownContent.tsx` (line 62) -- keep as-is for extracting code text for clipboard
- **`CopyButton`** concept -- keep but restructure: move from always-visible top-right to header-bar right-side with hover reveal
- **Design tokens** in `index.css` -- reuse `--color-surface-900`, `--color-surface-850`, `--color-surface-800`, `--color-text-secondary`, `--color-text-tertiary` for code block backgrounds, header, and labels
- **`--font-mono`** -- already set to JetBrains Mono, use for code blocks and language labels
- **`--ease-out-expo`** -- reuse for hover transitions on copy button
- **`animate-fade-in`** -- reuse for code block appearance
- **Prose overrides** in `index.css` `.prose {}` block -- keep, these handle non-code markdown styling
- **`AssistantMessage`** wrapper `max-w-[80%]` -- keep as-is
- **`messageGroups`** grouping logic in `ChatView.tsx` (lines 116-137) -- no changes needed

## Steps

- [ ] **Step 1: Update dependencies** -- Add `shiki` and `remark-gfm` to `package.json` dependencies. Remove `highlight.js` and `rehype-highlight`. Run `bun install` to update lockfiles
- [ ] **Step 2: Remove highlight.js CSS and overrides** -- In `src/renderer/src/index.css`: delete `@import "highlight.js/styles/github-dark.css"`, delete the `.hljs` and `pre code.hljs` override blocks in the components layer
- [ ] **Step 3: Add Shiki + code block CSS** -- In `src/renderer/src/index.css` components layer, add: `.shiki` base styles (background transparent, padding 0), code block container styles (border-radius, overflow handling), header bar styles (language label left, copy area right), `tab-size: 2`, `cursor: text`
- [ ] **Step 4: Rewrite MarkdownContent.tsx** -- Replace `rehype-highlight` plugin with a custom Shiki-based `code` component that: (a) detects language from className, (b) async-highlights via `shiki.highlighter.load()` with `github-dark` theme and a broad language set (python, typescript, javascript, bash, json, css, html, tsx, jsx, rust, go, sql, yaml, markdown), (c) renders a header bar with language label + hover-reveal copy button, (d) renders pre/code with Shiki HTML output. Add `remarkGfm` to plugins. Keep `extractText()` and inline code handling. Use a lazy singleton pattern for the Shiki highlighter (create once, reuse across all code blocks)
- [ ] **Step 5: Verify and test** -- Run `bun run dev`, send prompts that produce code blocks, verify: Shiki highlighting works, language labels appear, copy button reveals on hover, GFM tables render, no highlight.js artifacts remain

## Detailed: MarkdownContent.tsx Rewrite

The new component tree:

  MarkdownContent
    Markdown remarkPlugins={[remarkGfm]} components={...}
    code -> CodeBlock (handles both inline and block)
      Inline: code with bg-surface-800, text-accent-400
      Block: CodeBlockWithShiki
        Header bar
          Language label (left, text-text-tertiary, font-mono, text-xs)
          Copy button (right, opacity-0 group-hover:opacity-100)
        pre > code with Shiki HTML (bg-surface-900, border, rounded-lg)
    a -> external link (keep existing)
    pre -> wrapper (simplify - no duplicate bg/border since CodeBlock handles it)

**Shiki integration pattern** (preferred: lazy singleton):
- Create a module-level cached promise for the Shiki highlighter
- On first code block mount, call `shiki.createHighlighter()` with `github-dark` theme and a broad language set (python, typescript, javascript, bash, json, css, html, tsx, jsx, rust, go, sql, yaml, markdown)
- In component `useEffect`, await the cached promise, call `highlighter.codeToHtml(code, { lang, theme: 'github-dark' })`, set HTML state
- Render via `dangerouslySetInnerHTML` inside <code> (Shiki output is safe, pre-escaped)

**Language detection from className:**
- react-markdown passes `className="language-python"` for fenced blocks
- Extract: `className?.replace(/^language-/, '') ?? 'text'`

## Verification

1. `bun run dev` -- app starts without errors
2. Send a prompt asking for Python code -- code block renders with Shiki highlighting, "python" label in header, copy button hidden until hover
3. Send a prompt asking for a markdown table -- table renders correctly (GFM support)
4. Inline code renders with accent color on dark background
5. Copy button copies full code text, shows checkmark for 2s, then resets
6. No `highlight.js` CSS or classes remain in devtools
7. `bun run type-check` passes
8. `bun run lint` passes
