# @treeseed/cli

`@treeseed/cli` publishes the `treeseed` and `trsd` command surfaces. Use it to configure Treeseed, run local development, save/stage/release work, reconcile hosting, operate capacity providers, manage package images, and inspect workflow state.

The CLI is the human and automation entrypoint over package-owned capabilities. It delegates platform logic to `@treeseed/sdk`, web runtime orchestration to `@treeseed/core`, backend behavior to API surfaces, capacity runtime to `@treeseed/agent`, and TreeDX image workflows to package manifests.

## What You Can Do With The CLI

- configure local, staging, and production environments
- start and inspect local development instances
- save, stage, close, resume, and release multi-repo work
- plan/apply/verify hosted infrastructure through reconciliation
- run operations-runner smoke checks
- build and operate capacity provider runtime lifecycle
- inspect capacity plans, provider sessions, assignments, mode runs, and usage
- manage TreeDX package image workflows
- inspect package drift, workflow locks, and interrupted runs

## Install

```bash
npm install @treeseed/cli
```

After installation:

```bash
treeseed --help
trsd --help
```

In this workspace, use `npx trsd ...` from the root.

## Primary Commands

```bash
treeseed status --json
treeseed config
treeseed ready local --json
treeseed switch feature/my-change --plan --json
treeseed switch release --worktree --json
treeseed dev start --web-runtime local --json
treeseed save --verify local --json "describe the checkpoint"
treeseed stage --plan --json "describe the staging change"
treeseed release --patch --verify-deployed-resources --plan --json
treeseed recover --json
```

Runtime diagnostics:

```bash
treeseed operations smoke --environment local --service operationsRunner --json
treeseed ready staging --json
treeseed hosting plan --environment staging --service api --json
treeseed hosting verify --environment staging --service operationsRunner --live --json
treeseed operations smoke --environment staging --service operationsRunner --json
```

Capacity providers:

```bash
treeseed capacity build
treeseed capacity up
treeseed capacity status
treeseed capacity logs
treeseed capacity down
treeseed capacity test-local
```

Capacity lifecycle commands reconcile or inspect provider runtime. Assignment policy, provider sessions, assignments, mode runs, and usage settlement are API control-plane records exposed through explicit inspection/diagnostic commands; CLI must not become a hidden scheduler.

Capacity coordination inspection:

```bash
treeseed capacity plan --market local --project project_123 --environment local --json
treeseed capacity allocation-sets --market local --team team_123 --json
treeseed capacity agent-classes --market local --project project_123 --json
treeseed capacity provider-sessions --market local --team team_123 --provider provider_123 --json
treeseed capacity assignments --market local --team team_123 --status leased --json
treeseed capacity mode-runs --market local --project project_123 --mode planning --json
treeseed capacity decision-planning --market local --decision decision_123 --json
treeseed capacity execution-inputs --market local --decision decision_123 --json
treeseed capacity capacity-plans --market local --decision decision_123 --json
treeseed capacity capacity-plan --market local --capacity-plan capacity_plan_123 --json
treeseed capacity workday-summary --market local --workday workday_123 --json
treeseed capacity assignment-explanation --market local --team team_123 --assignment assignment_123 --json
```

TreeDX package image:

```bash
treeseed package image --package treedx --branch staging --plan --json
treeseed package image --package treedx --branch staging --sync-config --json
treeseed package image --package treedx --branch staging --execute --json
```

Use `treeseed help <command>` for command-specific usage and examples.

## Managed Package Set

The CLI coordinates the root market repo plus checked-out package repositories:

- `@treeseed/sdk`
- `@treeseed/ui`
- `@treeseed/core`
- `@treeseed/admin`
- `@treeseed/api`
- `@treeseed/cli`
- `@treeseed/agent`
- `packages/treedx`

Workflow commands save package repos in dependency order, update workspace submodule pointers when this checkout uses them, verify package release gates, and avoid one-off provider mutation. Those submodule pointer updates are package-workspace mechanics; project architecture and imported content are modeled separately through repository identity, `rootPath`, `sitePath`, `contentPath`, and local materialization policy.

## Save, Stage, And Release

`treeseed save` is the default checkpoint command. It saves dirty package repositories first, restores workspace links, performs lightweight release-candidate validation, and then saves the root market repo.

```bash
treeseed save --json "describe the checkpoint"
treeseed save --verify local --json "describe the checkpoint"
treeseed save --lane promotion --json "describe the checkpoint"
```

`treeseed stage` and `treeseed release` are promotion-grade commands. Use `--plan` before risky operations:

```bash
treeseed stage --plan --json "describe the staging change"
treeseed stage --verify-deployed-resources --json "describe the staging change"
treeseed release --patch --verify-deployed-resources --plan --json
```

Managed task worktrees created by `treeseed switch <branch> --worktree --json` live under `.treeseed/worktrees/<branch-slug>`. A branch may have only one active managed worktree. Successful `stage` merges the task branch into `staging`, waits on the selected verification/deployment gates, and removes the staged branch/worktree. If a root or package merge conflicts, the workflow records the conflicted paths, aborts the integration where possible, and stops before hosted deployment.

Interrupted workflow runs are journaled under `.treeseed/workflow`:

```bash
treeseed recover --json
treeseed resume <run-id> --json
```

## How CLI Fits With Other Packages

- `@treeseed/sdk` owns workflow, reconciliation, config, package discovery, and platform primitives.
- `@treeseed/core` owns the local web runtime used by `treeseed dev`.
- `@treeseed/admin` and `@treeseed/ui` are consumed by the web app; CLI does not own those routes or components.
- `@treeseed/api` owns backend API and operations-runner implementation.
- `@treeseed/api` owns durable capacity coordination records and assignment APIs.
- `@treeseed/agent` owns capacity-provider runtime artifacts that CLI starts or reconciles.
- TreeDX owns its service/image; CLI exposes package-image workflow commands.

## Package Development

From this package root:

```bash
npm install
npm run build
npm test
npm run release:verify
```

Release verification checks the packaged command surface, parser/help behavior, build output, and publishable artifact shape.

## What CLI Does Not Own

- SDK reconciliation internals
- Core web runtime internals
- Admin routes or UI components
- backend API implementation
- capacity-provider runtime implementation
- TreeDX service internals
- root market content or ecommerce

See the root [Package Ownership](../../docs/package-ownership.md) guide for cross-package boundaries.
