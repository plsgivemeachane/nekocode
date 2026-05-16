# Contributing to NekoCode

First off, thank you for considering contributing to NekoCode! It's people like you that make NekoCode such a great tool.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Enhancements](#suggesting-enhancements)

## Code of Conduct

This project and everyone participating in it is governed by the [NekoCode Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/your-username/nekocode.git
   cd nekocode
   ```
3. **Add the upstream** remote:
   ```bash
   git remote add upstream https://github.com/plsgivemeachane/nekocode.git
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feat/my-feature
   ```

## How Can I Contribute?

### Report Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (e.g., screenshots, error logs)
- **Describe the behavior you observed** and the behavior you expected
- **Include your environment details** (OS, NekoCode version, etc.)

### Suggest Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a step-by-step description** of the suggested enhancement
- **Describe the current behavior** and explain the expected behavior
- **Explain why this enhancement would be useful** to most NekoCode users

### Write Code

Look for issues labeled `good first issue`, `help wanted`, or `bug`. Feel free to ask questions in the issue comments before starting work.

## Development Setup

### Prerequisites

- **Node.js** >= 18
- **Bun** (package manager — do NOT use npm)
- **Git**
- **Windows**: PowerShell 7+ (for build scripts)

### Installation

```bash
# Install dependencies
bun install

# Start the dev server
bun run dev
```

### Project Architecture

NekoCode is an Electron desktop app structured as:

- **`src/main/`** — Electron main process (IPC, session management, project management, extensions)
- **`src/preload/`** — Electron preload (IPC bridge exposure)
- **`src/renderer/`** — React UI (components, hooks, stores, utils)
- **`src/shared/`** — Types shared between main and renderer
- **`src/tests/`** — Unit and integration tests

### Key Technologies

| Technology | Purpose |
|---|---|
| Electron | Desktop app shell |
| React + Tailwind + Radix UI | UI components |
| TypeScript | Type-safe development |
| electron-vite | Build toolchain |
| Bun | Package manager & script runner |
| Vitest | Testing framework |
| ESLint | Linting |

## Development Workflow

1. **Create a feature branch** from `main`
2. **Make your changes** following our coding standards
3. **Write tests** for your changes
4. **Run all checks** before committing:
   ```bash
   bun run test          # Run tests (Vitest)
   bun run lint          # Lint with ESLint
   bun run type-check    # TypeScript type checking
   bun run package:local # Verify local build works
   ```
5. **Commit** using Conventional Commits format
6. **Push** and open a Pull Request

## Coding Standards

### TypeScript

- Use strict TypeScript — no `any` types unless absolutely necessary
- Prefer interfaces over type aliases for object shapes
- Use explicit return types for exported functions
- Keep type definitions in `src/shared/` when shared between processes

### React

- Use functional components with hooks
- Follow the custom hooks pattern (`use*` naming)
- Keep components small and focused
- Use Radix UI primitives — no raw CSS files
- Apply Tailwind utility classes for styling

### Code Comments

- **NEVER remove existing comments** — only add new ones
- Comments should explain "why", not "what"
- Use JSDoc for public APIs and exported functions

### Error Handling

- Handle errors explicitly — no silent catches
- No hardcoded secrets or credentials
- Validate inputs at process boundaries (IPC, API calls)

### Package Manager

- **Always use Bun** — never npm or yarn
- Use `bun run <script>` for running scripts
- Use `bunx` instead of `npx`

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, whitespace) |
| `refactor` | Code refactoring without feature/fix changes |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Build process or tooling changes |
| `ci` | CI/CD changes |

### Examples

```
feat(chat): add markdown rendering support
fix(session): resolve stale cache on session switch
docs(readme): update installation instructions
test(stream-batcher): add batching edge case tests
```

## Pull Request Process

1. **Update documentation** if your changes affect behavior
2. **Add tests** for any new functionality
3. **Ensure all CI checks pass**:
   - `bun run test`
   - `bun run lint`
   - `bun run type-check`
4. **Keep PRs focused** — one logical change per PR
5. **Write a clear PR description** explaining:
   - What changes you made
   - Why you made them
   - How to test them
6. **Link related issues** in the PR description
7. **Be responsive** to code review feedback

### PR Title Format

Use the same Conventional Commits format:

``
feat(component): description of change
fix(component): description of fix
``

## Bug Fix Documentation

For every bug fix, you **must** write a detailed description in the `/docs/bugs/` folder documenting:

- The bug description and symptoms
- Root cause analysis
- How the fix resolves the issue
- Steps to verify the fix

## Questions?

Don't hesitate to open an issue with the `question` label or start a discussion on GitHub. We're happy to help!
