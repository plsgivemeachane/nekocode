# Zoom Out Button Displays Literal "−" Instead of Minus Sign

**Date:** 2026-05-31
**Severity:** Low (cosmetic/UX)
**Component:** NavBar (zoom controls)
**File:** `src/renderer/src/components/layout/NavBar.tsx`

## Bug Description

The zoom out button in the NavBar was displaying the literal text `−` instead of rendering an actual minus sign (`-`). This made the button look broken, showing a backslash-u escape sequence instead of the intended minus symbol.

## Root Cause

In JSX, Unicode escape sequences like `−` (Unicode MINUS SIGN, U+2212) are **not** interpreted when written as plain text content between JSX tags. JSX treats text content as literal strings, so `−` was rendered as the four-character escape sequence `−` rather than being converted to the Unicode character `−`.

The problematic code was:
```jsx
<button ...>
  −
</button>
```

In JSX plain text, `−` is just literal characters: `\`, `u`, `2`, `2`, `1`, `2`.

## Fix

Changed the zoom out button text from the literal `−` to a regular ASCII hyphen-minus `-`, which is consistent with the zoom in button that uses the ASCII `+` character.

```jsx
// Before
<button ...>
  −
</button>

// After
<button ...>
  -
</button>
```

## Why This Approach

- The zoom in button uses `+` (ASCII plus), so using `-` (ASCII hyphen-minus) is visually consistent
- No need for the Unicode minus sign (U+2212) when a simple `-` communicates the same intent
- If the Unicode minus sign were desired, the correct JSX syntax would be `{'−'}` (inside curly braces as a JS string expression) or the literal character `−`

## Verification

Visual inspection of the NavBar after the fix confirms the zoom out button now displays a proper `-` character.
