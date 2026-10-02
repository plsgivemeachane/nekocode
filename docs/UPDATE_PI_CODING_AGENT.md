# Update Pipeline: `@earendil-works/pi-coding-agent`

> **Purpose:** Step-by-step procedure to update the Pi SDK dependency to the target version
> and re-apply NekoCode's patches.  
> **Package:** `@earendil-works/pi-coding-agent`  
> **Patch tool:** `patch-package` (via `bunx`)  
> **Patch guide:** `docs/PATCH_GUIDE.md`  
> **Patch file:** `patches/@earendil-works+pi-coding-agent+<VERSION>.patch`

> **⚠️ Important:** This project also carries `@aws-crypto` patches (`@aws-crypto+util+5.2.0.patch`
> and `@aws-crypto+sha256-browser+5.2.0.patch`) that fix electron-builder's node module traversal.
> These patches are independent of the Pi SDK version but depend on the transitive `@aws-sdk` versions.
> See **Step 9b** and `docs/bugs/aws-crypto-smithy-version-mismatch.md`.

---

## Prerequisites

- Bun installed (`bun --version`)
- Node.js installed (`node --version`) — needed by the build and verification scripts
- Clean git working tree (commit or stash any pending changes)

---

## Pipeline

### Step 1 — Remove old artifacts

Remove only the installed dependency tree and any generated npm lockfile. Keep `bun.lock` so
unrelated resolutions and the rest of the dependency graph remain stable:

```bash
rm -f package-lock.json
rm -rf node_modules
```

### Step 2 — Move old patch file out of `patches/`

Move the old patch file to a temporary location so that `patch-package`'s `postinstall`
hook doesn't fail when it tries to apply a patch that targets the previous version:

```bash
mv patches/@earendil-works+pi-coding-agent+OLD_VERSION.patch /tmp/
```

> Replace `OLD_VERSION` with the current version string (e.g. `0.73.0`).
> The file will be permanently deleted later in Step 7.

### Step 3 — Update version in `package.json`

Edit the `dependencies` entry:

```json
"@earendil-works/pi-coding-agent": "<NEW_VERSION>"
```

Confirm the installed target version after `bun install`:

```bash
node -e "console.log(require('./node_modules/@earendil-works/pi-coding-agent/package.json').version)"
```

### Step 4 — Install dependencies with Bun

```bash
bun install
```

This installs all dependencies including the new Pi SDK version.
Because the old patch file was moved out in Step 2, `postinstall` (`patch-package`)
will run cleanly — there is no stale patch to mismatch.

### Step 5 — Apply patches manually

Before editing, create the pristine temporary checkout using the setup commands
in Step 7. Apply the edits there, or copy the edited files there after the
pristine commit. Never use already-patched files as the pristine baseline.

You have two options:

#### Option A — Use PATCH_GUIDE.md (preferred for major version bumps)

Follow every patch in `docs/PATCH_GUIDE.md` against the newly installed
`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`.

Each patch section has a **Locate** and **Replace with** block. Apply them in order:

1. Patch 1 — TypeBox `require.resolve` try/catch
2. Patch 2 — `resolveWorkspaceOrImport` try/catch
3. Patch 3 — `interopDefault` helper
4. Patch 4 — Provide `virtualModules` for the bundled worker (preserve 0.99.2 resolution branches)
5. Patch 5 — Extension error stack traces

#### Option B — Port from old patch file (faster for minor bumps)

If the file `dist/core/extensions/loader.js` hasn't changed structurally between versions,
you can read the old patch file (`patches/@earendil-works+pi-coding-agent+OLD_VERSION.patch`)
and manually apply the same edits to the new version's file.

Verify the edits are correct by checking that the surrounding code context matches.

### Step 6 — Delete old patch file

Delete the old patch file that was moved to `/tmp/` in Step 2:

```bash
rm /tmp/@earendil-works+pi-coding-agent+OLD_VERSION.patch
```

### Step 7 — Generate new patch file

Generate the replacement patch from pristine package files in a temporary Git repository. This
avoids relying on npm's lockfile format and makes the patch paths relative to `node_modules/`:

```bash
tmp_dir=$(mktemp -d)
git -C "$tmp_dir" init
mkdir -p "$tmp_dir/node_modules/@earendil-works"
cp -a node_modules/@earendil-works/pi-coding-agent \
  "$tmp_dir/node_modules/@earendil-works/"
git -C "$tmp_dir" add node_modules
git -C "$tmp_dir" -c user.name=patch -c user.email=patch@example.invalid commit -m pristine
# Run the commands above BEFORE Step 5 edits.
# Apply the documented edits in the temporary checkout, then:
git -C "$tmp_dir" diff -- node_modules/@earendil-works/pi-coding-agent \
  > patches/@earendil-works+pi-coding-agent+NEW_VERSION.patch
rm -rf "$tmp_dir"
```

The resulting patch must contain paths rooted at `node_modules/@earendil-works/pi-coding-agent/`.
Do not generate or commit `package-lock.json`; regenerate `bun.lock` with `bun install` only when
the manifest actually changed.

### Step 8 — Verify the patch

Run the patch verification script and full test suite:

```bash
bun run verify:patches
bun run test
bun run lint
bun run type-check
bun run build:worker
```

All commands must pass. If any fail, re-check the manual edits from Step 5.

### Step 8b — Verify `@aws-crypto` patches still apply

The Pi SDK update may pull in different transitive `@aws-sdk` / `@aws-crypto` versions.
After `bun install`, verify that the existing `@aws-crypto` patches still apply and that the
electron-builder build succeeds:

```bash
bunx patch-package --error-on-fail # active Pi patch must apply cleanly
bun run package:local        # must complete without "production dependency not found"
```

If `patch-package` fails to apply the `@aws-crypto` patches, the package versions likely changed.
Check the installed versions:

```bash
node -e "console.log(require('./node_modules/@aws-crypto/util/package.json').version)"
node -e "console.log(require('./node_modules/@aws-crypto/sha256-browser/package.json').version)"
```

If the versions changed from `5.2.0`, rename the patch files accordingly and update
`scripts/verify-patches.cjs`. See `docs/bugs/aws-crypto-smithy-version-mismatch.md` for the
full diagnostic and patch generation procedure.

### Step 9 — Documentation

1. Update the **target version** at the top of `docs/PATCH_GUIDE.md`:
   ```
   > **Target version:** `<NEW_VERSION>`
   ```

2. Update the **patch file path** reference in `docs/PATCH_GUIDE.md`:
   ```
   > **Patch file:** `patches/@earendil-works+pi-coding-agent+<NEW_VERSION>.patch`
   ```

3. Update this file's references if any steps changed.

4. Commit all changes:
   ```bash
   git add package.json patches/ docs/PATCH_GUIDE.md docs/UPDATE_PI_CODING_AGENT.md
   git commit -m "chore: update @earendil-works/pi-coding-agent to <NEW_VERSION>"
   ```

---

## Quick Reference

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `rm -f package-lock.json && rm -rf node_modules` | Clean installed tree |
| 2 | `mv patches/...OLD_VERSION.patch /tmp/` | Move stale patch out |
| 3 | Edit `package.json` version | Target new version |
| 4 | `bun install` | Install deps (postinstall runs cleanly) |
| 5 | Manual edits per `PATCH_GUIDE.md` | Apply patches |
| 6 | `rm /tmp/...OLD_VERSION.patch` | Delete old patch |
| 7 | Temporary Git repo + `git diff -- node_modules/...` | Generate new patch |
| 8 | `bun run verify:patches && bun run test && bun run lint && bun run type-check` | Validate |
| 8b | `bunx patch-package && bun run package:local` | Verify @aws-crypto patches + build |
| 9 | Update docs, commit | Document & ship |

---

## Troubleshooting

### The generated patch has incorrect paths

Regenerate it from the pristine temporary Git repository and pass an explicit pathspec rooted at
`node_modules/@earendil-works/pi-coding-agent/`. Do not introduce a `package-lock.json` just for
patch generation.

### Patch doesn't apply cleanly after version bump

The upstream `dist/core/extensions/loader.js` may have changed. Use **Option A** (PATCH_GUIDE.md)
to re-apply patches against the new source, then regenerate.

### Extensions fail to load after update

1. Check that all 5 patches from PATCH_GUIDE.md were applied
2. Verify `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js` contains:
   - `try/catch` around `require.resolve("typebox")`
   - `try/catch` around `import.meta.resolve()`
   - `interopDefault` function
   - `virtualModules: VIRTUAL_MODULES` in jiti config
3. Run `bun run build:worker` and check for build errors

### `electron-builder` fails with "production dependency not found"

This is the `@aws-crypto` / `@smithy` version mismatch. See `docs/bugs/aws-crypto-smithy-version-mismatch.md`.

Quick fix:

```bash
# Check which @aws-crypto versions are installed
ls node_modules/@aws-crypto/*/package.json | ForEach-Object { $_; node -e "const p=require('$_');console.log(p.name+'@'+p.version)" }

# If versions changed from 5.2.0, regenerate the patches:
# 1. Edit node_modules/@aws-crypto/util/package.json: "@smithy/util-utf8": "^2.0.0" → ">=2.0.0"
# 2. Edit node_modules/@aws-crypto/sha256-browser/package.json: same change
# 3. Generate patches via temp git repo (see bug doc)
# 4. Update scripts/verify-patches.cjs with new version strings
```

### Offline bundled-worker smoke validation

After building the worker, run `node scripts/smoke-worker.cjs`. This creates an
isolated temporary agent directory and project, loads a TypeScript extension
through the bundled SDK, and verifies session creation/reconnect, model
selection, deterministic offline streaming, and extension UI round trips.
For Pi 0.99.2 the worker build must define `PI_BUNDLED_NODE: true` so jiti embeds
its Babel transform. On Node 26, use
`NODE_OPTIONS=--no-experimental-webstorage bun run test` to avoid global Web
Storage shadowing jsdom's localStorage.

### Linux host validation limitation

On a host without Wine, `bun run package:local` completes Vite/worker builds and
production dependency traversal but fails while editing the Windows executable
with `wine is required`. Run
`bun run package:local --dir -c.win.signAndEditExecutable=false` to validate an
unsigned unpacked Windows artifact. This fallback does not validate NSIS or
portable installers; full installer validation still requires Windows or Wine.

The existing threaded-auth limitation remains: worker runtimes read their SDK
credential file directly and cannot decrypt Electron safeStorage values written
by the main process. This predates the upgrade; the offline smoke test does not
validate real encrypted credentials or provider login. A main-process credential
bridge is separate work. The restored backend exports preserve the main-process
encrypted adapter without changing this existing worker boundary.

### Archived AWS crypto patches in 0.99.2

The new locked dependency graph no longer contains `@aws-crypto/util` or
`@aws-crypto/sha256-browser`. Their original 5.2.0 patches are preserved under
`docs/patches/archive/`, outside patch-package's active directory. If a future SDK
reintroduces these packages, restore the appropriate patches to `patches/`
and revalidate their versions and dependency ranges before building.
