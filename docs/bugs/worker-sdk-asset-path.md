# Worker SDK asset path and version mismatch

## Bug

The worker build copied the Pi SDK's runtime metadata from the old
`@mariozechner/pi-coding-agent` package path. NekoCode depends on the
`@earendil-works/pi-coding-agent` distribution, so the copy could be skipped or
could contain metadata for a different SDK version. At runtime the bundled
worker then could not resolve its package directory or load the SDK's dynamic
documentation and changelog assets.

## Fix

`scripts/build-worker.cjs` now copies from the exact package named by the
manifest dependency. It requires an exact dependency pin, fails when the
installed package is missing, and verifies both the source and copied
`package.json` name and version against that pin. The build script also exports
its asset-copy helper without running the build when imported, allowing a
regression test to cover the copy and validation behavior.

## Verification

The worker build regression tests verify that the expected package metadata and
static assets are copied and that a stale or incorrectly named SDK fails before
the worker output is accepted.

The 0.99.2 upgrade also requires esbuild's `PI_BUNDLED_NODE: true` definition.
Without it, upstream selects jiti's ordinary lazy Babel loader, which resolves
`../dist/babel.cjs` relative to the worker bundle and cannot load TypeScript
extensions. The definition selects upstream's static embedded transform loader.
`node scripts/smoke-worker.cjs` verifies this with an offline provider, a TypeBox
extension, streamed output, persisted reconnect, model selection, and UI requests.
