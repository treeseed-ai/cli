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

`@treeseed/cli` is a thin installable wrapper over `@treeseed/sdk` workflow and operations interfaces plus the Treeseed runtime packages. `treeseed dev` resolves the tenant-installed or sibling-workspace `@treeseed/core` web runtime, while `treeseed agents ...` delegates to `@treeseed/agent`. In normal consumer installs, npm resolves the runtime dependencies automatically.

Workflow guarantees:

- `treeseed` is the only supported project-management surface for market and any checked-out `packages/sdk`, `packages/core`, and `packages/cli` repos.
- `treeseed switch` requires clean worktrees, mirrors the task branch into checked-out package repos, and only pushes the market branch on branch creation.
- `treeseed save` is the canonical recursive checkpoint command: it verifies, commits, and pushes dirty package repos in dependency order before saving the market repo.
- `treeseed stage` squash-merges task branches into `staging` across package repos first, refreshes market submodule pointers to package `staging` heads, then stages the market repo.
- `treeseed close` recursively archives and deletes matching task branches across market and checked-out package repos.
- `treeseed release` only bumps, tags, and publishes changed packages plus internal dependents, then syncs market production to package `main` heads.
- Every mutating workflow command supports `--plan`; `--dry-run` is only an alias where it still exists for compatibility.
- Interrupted workflow runs are journaled under `.treeseed/workflow`; use `treeseed recover` to inspect them and `treeseed resume <run-id>` to continue a resumable run.

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
- `treeseed save [--preview] [--plan] "<commit message>"`
- `treeseed stage "<resolution message>"`
- `treeseed close "<close reason>"`
- `treeseed release --major|--minor|--patch [--plan]`
- `treeseed resume <run-id>`
- `treeseed recover`
- `treeseed destroy --environment <local|staging|prod> [--plan]`

Support utilities such as `treeseed rollback`, `treeseed doctor`, `treeseed auth:*`, `treeseed template`, `treeseed sync`, `treeseed lint`, `treeseed test`, `treeseed build`, service helpers, and `treeseed agents ...` remain available.

Use `treeseed help` for the full command list and `treeseed help <command>` for command-specific usage, options, and examples.

## Common Commands

```bash
treeseed status
treeseed config
treeseed switch feature/search-improvements --plan
treeseed switch feature/search-improvements --preview
treeseed dev
treeseed save --preview "feat: add search filters"
treeseed stage "feat: add search filters"
treeseed release --patch
treeseed recover
treeseed status --json
```

## Agent-Safe Workflow

Use planning mode before any destructive or multi-repo mutation:

```bash
treeseed switch feature/search-improvements --plan --json
treeseed save --plan "feat: add search filters" --json
treeseed stage --plan "feat: add search filters" --json
treeseed release --patch --plan --json
```

If a workflow stops partway through, inspect the journaled state and resume from the recorded run:

```bash
treeseed recover
treeseed resume <run-id>
```

In a full checked-out workspace, `treeseed tasks`, `treeseed status`, and `treeseed doctor` also report package-branch drift, dirty embedded repos, active workflow locks, and interrupted runs.

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
