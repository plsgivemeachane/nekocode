# Bug: Electron Binary Missing — Postinstall Skipped by Bun

**Date:** 2026-05-10  
**Severity:** Critical (blocks all dev/build)  
**Area:** Build / Dev Environment  
**Root Cause:** Bun skipped Electron's postinstall script during `bun install`

---

## Symptoms

Running `bun run dev` produced:

```
error during start dev server and electron app:
Error: Electron uninstall
    at getElectronPath (file:///E:/project/node/nekocode/node_modules/electron-vite/dist/chunks/lib-ClgyQuZx.js:132:19)
    at startElectron (file:///E:/project/node/nekocode/node_modules/electron-vite/dist/chunks/lib-ClgyQuZx.js:205:26)
```

The Vite renderer dev server started successfully on `http://localhost:5173/`, and both the main process and preload built without errors. The failure occurred only when electron-vite attempted to launch the Electron app process.

---

## Root Cause Analysis

### What was present
- `node_modules/electron/` directory existed with `package.json`, `index.js`, `install.js`, `checksums.json`
- Electron package version: **34.5.8**

### What was missing
- `node_modules/electron/path.txt` — does not exist
- `node_modules/electron/dist/` — does not exist

### How `electron` resolves its binary

The `node_modules/electron/index.js` file contains:

```js
const pathFile = path.join(__dirname, 'path.txt');

function getElectronPath () {
  let executablePath;
  if (fs.existsSync(pathFile)) {
    executablePath = fs.readFileSync(pathFile, 'utf-8');
  }
  if (executablePath) {
    return path.join(__dirname, 'dist', executablePath);
  } else {
    throw new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again');
  }
}
```

The `electron` npm package is a **wrapper** — it does not contain the Electron binary itself. The actual binary (~190 MB `electron.exe` on Windows) is downloaded during the `postinstall` lifecycle hook (`install.js`). Bun, in certain configurations or versions, can skip `postinstall` scripts, leaving the wrapper package present but the binary absent.

### Why `electron-rebuild` did not fix it

`electron-rebuild` recompiles native Node addons (`.node` files) against Electron's Node headers. It has nothing to do with downloading the Electron binary itself. Running it reported "No native modules found" and completed without error, but the underlying binary absence remained.

---

## Fix

Run the Electron install script directly:

```powershell
node node_modules/electron/install.js
```

This downloads the Electron v34.5.8 binary into `node_modules/electron/dist/` and creates `path.txt` containing `electron.exe`.

### Verification after fix

```powershell
# Should return True
Test-Path "node_modules/electron/path.txt"
Test-Path "node_modules/electron/dist"

# Should contain "electron.exe"
Get-Content "node_modules/electron/path.txt"

# Should list electron.exe + supporting files
Get-ChildItem "node_modules/electron/dist"
```

---

## Prevention

After running `bun install` on a fresh clone or after `rm -rf node_modules`, always verify the Electron binary exists:

```powershell
Test-Path "node_modules/electron/dist/electron.exe"
```

If missing, run:

```powershell
node node_modules/electron/install.js
```

Alternatively, consider adding a postinstall check to `package.json` or a setup script that ensures the Electron binary is present before dev/build commands execute.

---

## Blast Radius

- **Blocked:** `bun run dev` (dev server + Electron launch)
- **Blocked:** Any `electron-vite` command that needs to spawn Electron
- **Not affected:** Main process build, preload build, renderer Vite dev server, tests, linting
