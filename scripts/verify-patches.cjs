const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJsonPath = path.join(root, "package.json");
const requiredPatch = "@mariozechner+pi-coding-agent+0.64.0.patch";
const patchPath = path.join(root, "patches", requiredPatch);

function fail(message) {
  console.error(`[verify:patches] ${message}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(packageJsonPath)) {
    fail("package.json not found");
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const deps = packageJson.dependencies || {};
  const devDeps = packageJson.devDependencies || {};
  const scripts = packageJson.scripts || {};

  if (!("@mariozechner/pi-coding-agent" in deps)) {
    fail("@mariozechner/pi-coding-agent must exist in dependencies");
  }

  if (!("patch-package" in deps) && !("patch-package" in devDeps)) {
    fail("patch-package must exist in dependencies or devDependencies");
  }

  if (typeof scripts.postinstall !== "string" || !scripts.postinstall.includes("patch-package")) {
    fail("scripts.postinstall must include patch-package");
  }

  if (!fs.existsSync(patchPath)) {
    fail(`required patch file is missing: patches/${requiredPatch}`);
  }

  console.log(`[verify:patches] OK - patch-package and patches/${requiredPatch} are present.`);
}

main();
