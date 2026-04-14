# `@treeseed/cli`

Operator-facing Treeseed CLI package.

This package publishes the `treeseed` binary. `@treeseed/sdk` owns the reusable workflow and runtime capabilities, `@treeseed/core` owns integrated local platform orchestration, and `@treeseed/cli` owns argv parsing, command help, terminal formatting, command handlers, and the installable executable surface.

## Requirements

- Node `>=22`
- npm as the canonical package manager for install, CI, and release flows

## Install

Install the CLI with its runtime dependencies:

```bash
npm install @treeseed/cli @treeseed/core @treeseed/sdk
```

`@treeseed/cli` is a thin installable wrapper over `@treeseed/sdk` workflow and operations interfaces plus the `@treeseed/core` runtime namespaces. `treeseed dev` and `treeseed agents ...` resolve and delegate to the tenant-installed or sibling-workspace `@treeseed/core` runtime. In normal consumer installs, npm resolves the runtime dependencies automatically.

Workflow guarantees:

- `treeseed init`, `treeseed config`, and `treeseed release` resolve the project from nested directories and do not rely on the currently checked-out task branch.
- `treeseed switch` requires a clean worktree before leaving the current branch and creates new task branches from the latest `staging`.
- `treeseed save` is the canonical checkpoint command: it syncs the current branch with origin, succeeds even when no new changes exist, and can create or refresh preview deployments with `--preview`.
- `treeseed stage` and `treeseed close` auto-save meaningful uncommitted task-branch changes before merge or cleanup, then leave the repository on `staging`.
- `treeseed release` completes on `staging` after promoting `staging` into `main` and pushing the release tag.

After installation, the published binary is available as:

```bash
treeseed --help
```

## Primary Workflow

The main workflow commands exposed by the current CLI are:

- `treeseed status [--json]`
- `treeseed config`
- `treeseed tasks [--json]`
- `treeseed switch <branch-name> [--preview]`
- `treeseed dev`
- `treeseed save [--preview] "<commit message>"`
- `treeseed stage "<resolution message>"`
- `treeseed close "<close reason>"`
- `treeseed release --major|--minor|--patch`
- `treeseed destroy --environment <local|staging|prod>`

Support utilities such as `treeseed rollback`, `treeseed doctor`, `treeseed auth:*`, `treeseed template`, `treeseed sync`, `treeseed lint`, `treeseed test`, `treeseed build`, service helpers, and `treeseed agents ...` remain available.

Use `treeseed help` for the full command list and `treeseed help <command>` for command-specific usage, options, and examples.

## Common Commands

```bash
treeseed status
treeseed config
treeseed switch feature/search-improvements --preview
treeseed dev
treeseed save --preview "feat: add search filters"
treeseed stage "feat: add search filters"
treeseed release --patch
treeseed status --json
```

## Maintainer Workflow

All package maintenance commands are npm-based and run from the `cli/` package root. This package verifies the published command surface, parser/help behavior, and packaged artifact shape.

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
3. Assert the published artifact only contains the thin wrapper entrypoints
4. Run the CLI wrapper test suite
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
- The README intentionally documents the command surface at a high level. The canonical source of operation identity and semantics is `@treeseed/sdk`, while `@treeseed/cli` owns argv parsing, help rendering, and terminal formatting.
