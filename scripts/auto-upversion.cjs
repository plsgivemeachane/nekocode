#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const args = new Set(process.argv.slice(2));

const bumpType = args.has('--major')
  ? 'major'
  : args.has('--minor')
    ? 'minor'
    : 'patch';
const isDryRun = args.has('--dry-run');

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function bumpSemver(version, type) {
  const parts = parseSemver(version);
  if (type === 'major') {
    return `${parts.major + 1}.0.0`;
  }
  if (type === 'minor') {
    return `${parts.major}.${parts.minor + 1}.0`;
  }
  return `${parts.major}.${parts.minor}.${parts.patch + 1}`;
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const oldVersion = packageJson.version;
const newVersion = bumpSemver(oldVersion, bumpType);

if (isDryRun) {
  console.log(`[dry-run] ${oldVersion} -> ${newVersion}`);
  console.log(`Mock commit: chore(release): bump version ${oldVersion} -> ${newVersion}`);
  process.exit(0);
}

packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

console.log(`Version bumped: ${oldVersion} -> ${newVersion}`);
console.log(`Suggested commit: chore(release): bump version ${oldVersion} -> ${newVersion}`);
