# Agent Instructions for This Repository

## Package Manager

- This project uses Bun, not npm.
- Always run scripts with `bun run <command>`.
- Never use `npm run <command>`.

## Command Runners

- Use `bunx` instead of `npx`.
- Never use `npx` in this repository.

## Testing and Validation

- Always run tests with `bun run test`.
- Never run `bun test` directly. It invokes Bun's internal test runner, not the project test runner.
- The `test` script in `package.json` maps to `vitest run`.

## Required Checks Before Commit

For every change, run all commands below and fix all errors before committing, even if they seem unrelated:

- `bun run test`
- `bun run lint`
- `bun run type-check`