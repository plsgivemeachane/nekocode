This project using bun
Please run
bun run <command>
rather than
npm run <command>
bunx is a wrapper around npx
## Testing

**WARNING:** Always use `bun run test` (with `run`). Never use `bun test` directly — that triggers bun's internal test runner, not vitest. The `"test"` script in `package.json` maps to `vitest run`.