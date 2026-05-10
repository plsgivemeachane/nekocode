const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJsonPath = path.join(root, "package.json");

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

  if (!("@earendil-works/pi-coding-agent" in deps)) {
    fail("@earendil-works/pi-coding-agent must exist in dependencies");
  }

  if (!("patch-package" in deps) && !("patch-package" in devDeps)) {
    fail("patch-package must exist in dependencies or devDependencies");
  }

  if (typeof scripts.postinstall !== "string" || !scripts.postinstall.includes("patch-package")) {
    fail("scripts.postinstall must include patch-package");
  }

  const agentVersion = deps["@earendil-works/pi-coding-agent"];
  const requiredPatch = `@earendil-works+pi-coding-agent+${agentVersion}.patch`;
  const patchPath = path.join(root, "patches", requiredPatch);

  if (!fs.existsSync(patchPath)) {
    fail(`required patch file is missing: patches/${requiredPatch}`);
  }

  // Verify @aws-crypto patches exist (required for electron-builder traversal with Bun)
  // These patches widen @smithy/util-utf8 from ^2.0.0 to >=2.0.0 to match the installed 4.x version.
  // See: docs/bugs/aws-crypto-smithy-version-mismatch.md
  const awsCryptoPatches = [
    "@aws-crypto+util+5.2.0.patch",
    "@aws-crypto+sha256-browser+5.2.0.patch",
  ];
  for (const patchFile of awsCryptoPatches) {
    const awsPatchPath = path.join(root, "patches", patchFile);
    if (!fs.existsSync(awsPatchPath)) {
      fail(`required patch file is missing: patches/${patchFile}`);
    }
  }

  console.log(`[verify:patches] OK - patch-package and patches/${requiredPatch} are present.`);
}

main();
