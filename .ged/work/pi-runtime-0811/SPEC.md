# SPEC: Update Pi runtime dependencies to latest

## Goal
Update GedPi's direct `@earendil-works/*` Pi runtime dependencies and compatibility aliases from `0.80.6` to the latest published Pi version.

## Scope
- Review pi.dev changelog before changing dependencies.
- Update root `package.json` and `package-lock.json` for:
  - `@earendil-works/pi-ai`
  - `@earendil-works/pi-coding-agent`
  - `@earendil-works/pi-tui`
  - `@mariozechner/pi-coding-agent` alias
  - `@mariozechner/pi-tui` alias
- Fix any compile/test failures caused by Pi API changes.
- Update tests and changelog.

## Changelog findings
Latest npm version for the scoped Pi runtime stack is `0.81.1`. pi.dev release notes identify the main compatibility risk as Pi `0.80.8`: SDK session options `authStorage`/`modelRegistry` were replaced with async `modelRuntime`, `ModelRuntime` projection helpers were removed, and extension-facing `ModelRegistry.refresh()` became async. This repo uses extension-facing `ctx.modelRegistry.find(...)`/`getAvailable()` but does not create SDK sessions or call the removed `ModelRuntime` helpers.
