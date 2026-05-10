# Update Pipeline: `@mariozechner/pi-coding-agent`

> **Purpose:** Step-by-step procedure to update the Pi SDK dependency to the latest version
> and re-apply NekoCode's patches.  
> **Package:** `@mariozechner/pi-coding-agent`  
> **Patch tool:** `patch-package` (via `bunx`)  
> **Patch guide:** `docs/PATCH_GUIDE.md`  
> **Patch file:** `patches/@mariozechner+pi-coding-agent+<VERSION>.patch`

---

## Prerequisites

- Bun installed (`bun --version`)
- Node.js installed (`node --version`) — needed for `npm` commands
- Clean git working tree (commit or stash any pending changes)

---

## Pipeline

### Step 1 — Remove old artifacts

Delete lockfiles and `node_modules` to start from a clean slate:

```bash
rm -f package-lock.json bun.lock
rm -rf node_modules
```

### Step 2 — Move old patch file out of `patches/`

Move the old patch file to a temporary location so that `patch-package`'s `postinstall`
hook doesn't fail when it tries to apply a patch that targets the previous version:

```bash
mv patches/@mariozechner+pi-coding-agent+OLD_VERSION.patch /tmp/
```

> Replace `OLD_VERSION` with the current version string (e.g. `0.73.0`).
> The file will be permanently deleted later in Step 7.

### Step 3 — Update version in `package.json`

Edit the `dependencies` entry:

```json
"@mariozechner/pi-coding-agent": "<NEW_VERSION>"
```

You can find the latest version on npm:

```bash
npm view @mariozechner/pi-coding-agent version
```

### Step 4 — Install dependencies with Bun

```bash
bun install
```

This installs all dependencies including the new Pi SDK version.
Because the old patch file was moved out in Step 2, `postinstall` (`patch-package`)
will run cleanly — there is no stale patch to mismatch.

### Step 5 — Apply patches manually

You have two options:

#### Option A — Use PATCH_GUIDE.md (preferred for major version bumps)

Follow every patch in `docs/PATCH_GUIDE.md` against the newly installed
`node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js`.

Each patch section has a **Locate** and **Replace with** block. Apply them in order:

1. Patch 1 — TypeBox `require.resolve` try/catch
2. Patch 2 — `resolveWorkspaceOrImport` try/catch
3. Patch 3 — `interopDefault` helper
4. Patch 4 — Always provide `virtualModules`
5. Patch 5 — Extension error stack traces

#### Option B — Port from old patch file (faster for minor bumps)

If the file `dist/core/extensions/loader.js` hasn't changed structurally between versions,
you can read the old patch file (`patches/@mariozechner+pi-coding-agent+OLD_VERSION.patch`)
and manually apply the same edits to the new version's file.

Verify the edits are correct by checking that the surrounding code context matches.

### Step 6 — Generate `package-lock.json` with npm

`patch-package` has known issues generating patches from Bun's resolution.
Create a `package-lock.json` using npm so `patch-package` can compute the diff correctly:

```bash
npm install --package-lock-only
```

> **Do NOT commit `package-lock.json`.** It is only needed temporarily for patch generation.

### Step 7 — Delete old patch file

Delete the old patch file that was moved to `/tmp/` in Step 2:

```bash
rm /tmp/@mariozechner+pi-coding-agent+OLD_VERSION.patch
```

### Step 8 — Generate new patch file

```bash
bunx patch-package @mariozechner/pi-coding-agent
```

This creates `patches/@mariozechner+pi-coding-agent+NEW_VERSION.patch`.

### Step 9 — Verify the patch

Run the patch verification script and full test suite:

```bash
bun run verify:patches
bun run test
bun run lint
bun run type-check
bun run build-worker
```

All commands must pass. If any fail, re-check the manual edits from Step 5.

### Step 10 — Cleanup

Remove the temporary `package-lock.json`:

```bash
rm -f package-lock.json
```

### Step 11 — Documentation

1. Update the **target version** at the top of `docs/PATCH_GUIDE.md`:
   ```
   > **Target version:** `<NEW_VERSION>`
   ```

2. Update the **patch file path** reference in `docs/PATCH_GUIDE.md`:
   ```
   > **Patch file:** `patches/@mariozechner+pi-coding-agent+<NEW_VERSION>.patch`
   ```

3. Update this file's references if any steps changed.

4. Commit all changes:
   ```bash
   git add package.json patches/ docs/PATCH_GUIDE.md docs/UPDATE_PI_CODING_AGENT.md
   git commit -m "chore: update @mariozechner/pi-coding-agent to <NEW_VERSION>"
   ```

---

## Quick Reference

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `rm -f package-lock.json bun.lock && rm -rf node_modules` | Clean slate |
| 2 | `mv patches/...OLD_VERSION.patch /tmp/` | Move stale patch out |
| 3 | Edit `package.json` version | Target new version |
| 4 | `bun install` | Install deps (postinstall runs cleanly) |
| 5 | Manual edits per `PATCH_GUIDE.md` | Apply patches |
| 6 | `npm install --package-lock-only` | Generate lockfile for patch-package |
| 7 | `rm /tmp/...OLD_VERSION.patch` | Delete old patch |
| 8 | `bunx patch-package @mariozechner/pi-coding-agent` | Generate new patch |
| 9 | `bun run verify:patches && bun run test && bun run lint && bun run type-check` | Validate |
| 10 | `rm -f package-lock.json` | Cleanup |
| 11 | Update docs, commit | Document & ship |

---

## Troubleshooting

### `patch-package` fails with "No such file or directory"

Ensure `package-lock.json` exists (Step 6). `patch-package` requires it to resolve package paths.

### Patch doesn't apply cleanly after version bump

The upstream `dist/core/extensions/loader.js` may have changed. Use **Option A** (PATCH_GUIDE.md)
to re-apply patches against the new source, then regenerate.

### Extensions fail to load after update

1. Check that all 5 patches from PATCH_GUIDE.md were applied
2. Verify `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js` contains:
   - `try/catch` around `require.resolve("typebox")`
   - `try/catch` around `import.meta.resolve()`
   - `interopDefault` function
   - `virtualModules: VIRTUAL_MODULES` in jiti config
3. Run `bun run build-worker` and check for build errors
