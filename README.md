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

- `treeseed` is the only supported project-management surface for market and any checked-out `packages/sdk`, `packages/core`, `packages/agent`, `packages/api`, `packages/cli`, and `packages/treedx` repos.
- Any command that mutates hosting, provider config, package workflow state, local runtime infrastructure, capacity-provider state, TreeDX hosting/image consumption, staging, or release must route through the SDK-owned reconciliation platform documented in the root `docs/reconciliation-platform.md`.
- `treeseed hosting`, `treeseed config`, `treeseed stage`, `treeseed release`, `treeseed dev`, `treeseed capacity`, `treeseed package image`, and `treeseed reconcile test-live` report canonical desired-state reconciliation data when they touch infrastructure.
- `treeseed switch` requires clean worktrees, mirrors the task branch into checked-out package repos, and only pushes the market branch on branch creation.
- `treeseed save` is the canonical recursive checkpoint command: it commits and pushes dirty package repos in dependency order before saving the market repo. It defaults to the fast save lane, which is optimized for frequent integrated development checkpoints without hosted CI/deploy waits or strict clean-install rehearsal.
- `treeseed stage` runs deployment readiness before hosted mutation, squash-merges task branches into `staging` across package repos first, refreshes market submodule pointers to package `staging` heads, then stages the market repo.
- `treeseed close` recursively archives and deletes matching task branches across market and checked-out package repos.
- `treeseed release` runs deployment readiness before version bumps, only bumps/tags/publishes changed packages plus internal dependents, then syncs market production to package `main` heads.
- `treeseed ready`, `treeseed hosting plan/apply/verify`, `treeseed audit hosting --live`, `treeseed doctor --live --hosted-services`, and `treeseed operations smoke` are the fail-fast operator tools for hosted deployment readiness.
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
- `treeseed ready <local|staging|prod> [--json]`
- `treeseed tasks [--json]`
- `treeseed switch <branch-name> [--preview]`
- `treeseed dev`
- `treeseed dev start|status|logs|stop|restart`
- `treeseed hosting plan|apply|verify --environment <local|staging|prod> [--service <id>] [--live]`
- `treeseed reconcile test-live --provider <railway|cloudflare|github|local|all> --environment <local|staging|prod>`
- `treeseed audit hosting --environment <local|staging|prod> [--live]`
- `treeseed operations smoke --environment <staging|prod> --service operationsRunner`
- `treeseed save [--lane fast|promotion] [--preview] [--plan] "<commit message>"`
- `treeseed stage [--plan] [--verify-deployed-resources] "<resolution message>"`
- `treeseed close "<close reason>"`
- `treeseed release --major|--minor|--patch [--plan] [--verify-deployed-resources]`
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
treeseed dev start --web-runtime local
treeseed ready local --json
treeseed save --json "feat: add search filters"
treeseed save --verify local --json "feat: add search filters"
treeseed save --lane promotion --json "feat: add search filters"
treeseed stage --plan --json "feat: add search filters"
treeseed stage --verify-deployed-resources --json "feat: add search filters"
treeseed release --patch --verify-deployed-resources --plan --json
treeseed recover
treeseed status --json
```

Hosted diagnostics:

```bash
treeseed ready staging --json
treeseed hosting plan --environment staging --service api --json
treeseed hosting verify --environment staging --service operationsRunner --live --json
treeseed operations smoke --environment staging --service operationsRunner --json
```

## Save Lanes

`treeseed save` has two workflow lanes. The lane controls how much proof is gathered during a checkpoint; it does not change package dependency ordering, version/tag updates, internal dependency rewrites, submodule pointer updates, lockfile validation, or workflow journaling.

### Fast Lane

Fast lane is the default:

```bash
treeseed save --json "describe the checkpoint"
treeseed save --lane fast --json "describe the checkpoint"
```

Use fast lane for normal development checkpoints. It saves package repositories in dependency order, updates internal Git refs and package lockfiles, restores workspace links before root verification, and runs lightweight release-candidate checks. On staging it defaults hosted CI to `off` and release-candidate mode to `hybrid`, so it does not wait for GitHub hosted workflows, Cloudflare Pages, Railway deployments, or strict clean-install rehearsal unless another option explicitly asks for them.

Fast lane is the right default for:

- routine code or documentation checkpoints
- frequent AI-agent saves where preserving progress matters more than hosted proof
- changes already covered by focused local tests
- low-risk package dependency ref updates where lockfile dry-run validation is enough for the checkpoint

Add `--verify local` when the checkpoint should run package-local verification before pushing:

```bash
treeseed save --verify local --json "describe the checkpoint"
```

This keeps the fast lane's hosted behavior, but local package/project verify scripts may still be expensive because dirty packages and dependents can run their own release verification, unit tests, builds, or smoke tests.

### Promotion Lane

Promotion lane is explicit:

```bash
treeseed save --lane promotion --json "describe the checkpoint"
```

Use promotion lane when a save should behave like a staging or release rehearsal. On staging it defaults hosted CI to `hosted` and release-candidate mode to `strict`, so the save waits for hosted workflow gates and performs strict release-candidate proof.

Promotion lane is appropriate for:

- risky changes to dependency topology, package manifests, release scripts, hosting manifests, or workflow orchestration
- checkpoints immediately before a staging handoff where hosted CI/CD proof is desired
- debugging hosted deployment behavior
- proving that a package set is ready for the stricter `stage` or `release` path

For narrower control, `--release-candidate strict` requests strict release-candidate checks without switching the whole save to promotion lane, and `--verify-deployed-resources` requests hosted provider resource checks when the checkpoint specifically needs live resource proof.

`treeseed stage` and `treeseed release` remain promotion-grade by default. The fast lane is intentionally only the default for ordinary `save`.

## Development Server Instances

`treeseed dev` remains the foreground local runtime supervisor. It delegates to `@treeseed/core`, starts the Market web/API/control-plane development surface, streams output in the active terminal, and exits when the shell-owned process is stopped.

Managed dev instances use subcommands:

```bash
treeseed dev start --web-runtime local --json
treeseed dev status --json
treeseed dev status --all --json
treeseed dev logs --follow
treeseed dev stop --json
treeseed dev restart --web-runtime local --json
```

Managed instances are scoped to the current physical worktree. The core runtime writes `.treeseed/dev/instances/<scope>.json`, `.treeseed/dev/pids/<scope>.pid`, and `.treeseed/logs/dev-<scope>.jsonl` in that worktree. A repository-family index under the git common dir makes sibling worktree instances discoverable to humans and AI agents.

`--force` replaces only the current worktree instance. `--force-conflicts` is the explicit cross-worktree port-owner escape hatch. Additional worktrees receive stable alternate port blocks and worktree-specific local PostgreSQL/Mailpit names, so many agents can run development sessions in the same repository family.

For the complete architecture, see the root workspace document `docs/local-dev-instances.md`.

## Agent-Safe Workflow

Use planning mode before any destructive or multi-repo mutation:

```bash
treeseed switch feature/search-improvements --plan --json
treeseed save --plan --json "feat: add search filters"
treeseed stage --plan --json "feat: add search filters"
treeseed release --patch --verify-deployed-resources --plan --json
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
