# `@treeseed/cli`

Operator-facing Treeseed CLI package.

This package publishes the `treeseed` binary. It provides the unified TypeScript command interface for Treeseed workspace setup, branch workflow, deployment, validation, and release automation.

## Requirements

- Node `>=20`
- npm as the canonical package manager for install, CI, and release flows

## Install

Install the CLI alongside the Treeseed runtime package:

```bash
npm install @treeseed/cli @treeseed/core
```

`@treeseed/cli` depends on `@treeseed/core`, `@treeseed/sdk`, and `@treeseed/agent` at package runtime. In normal consumer installs, npm resolves those package dependencies automatically.

After installation, the published binary is available as:

```bash
treeseed --help
```

## Primary Workflow

The main workflow commands exposed by the current CLI are:

- `treeseed setup`
- `treeseed work <branch-name> [--preview]`
- `treeseed ship "<commit message>"`
- `treeseed publish --environment <local|staging|prod>`
- `treeseed promote --major|--minor|--patch`
- `treeseed rollback <staging|prod> [--to <deploy-id|commit>]`
- `treeseed teardown [--environment <local|staging|prod>]`
- `treeseed status [--json]`
- `treeseed next [--json]`
- `treeseed continue [--json]`
- `treeseed doctor [--fix] [--json]`

The CLI also keeps compatibility commands such as `init`, `config`, `start`, `deploy`, `save`, `release`, `close`, and `destroy`.

Use `treeseed help` for the full command list and `treeseed help <command>` for command-specific usage, options, and examples.

## Common Commands

```bash
treeseed setup
treeseed work feature/search-improvements --preview
treeseed ship "feat: add search filters"
treeseed publish --environment staging
treeseed promote --patch
treeseed status --json
```

## Maintainer Workflow

All package maintenance commands are npm-based and run from the `cli/` package root.

Install dependencies:

```bash
npm install
```

Build the published package output:

```bash
npm run build
```

Run the package test suite:

```bash
npm test
```

Run full release verification:

```bash
npm run release:verify
```

The release verification flow is intentionally stricter than a normal test run:

1. Build `dist`
2. Validate publishable output for forbidden workspace references
3. Run the CLI test suite
4. Run scaffold verification
5. Pack the CLI tarball
6. Smoke-test the packed install by running `treeseed --help` from the packed artifact

## CI And Publishing

The GitHub Actions workflows under `.github/workflows/` assume this package is the repository root for the standalone CLI repository.

- `ci.yml` uses `npm ci`, `npm run build`, `npm test`, and `npm run release:verify`
- `publish.yml` uses the same verification path before publishing to npm
- `publish.yml` validates that the pushed tag matches the package version before `npm publish`

Release tags must use this format:

```text
<version>
```

For example, package version `0.1.0` publishes from tag `0.1.0`.

## Notes

- `package-lock.json` should be committed and kept current so `npm ci` remains reproducible in CI and release jobs.
- The README intentionally documents the command surface at a high level. The canonical source of command usage and options is the CLI help output generated from `src/cli/registry.ts`.
