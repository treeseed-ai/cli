# @treeseed/cli

`@treeseed/cli` publishes one executable: `trsd`. It is the human and automation interface to TreeSeed's authoritative control-plane API.

The CLI accepts high-level intent, renders read projections, and returns durable receipts. It does not let clients author derived capacity plans, assignments, leases, reservations, settlements, or repository integration records.

## Install

```sh
npm install --global @treeseed/cli
trsd --help
```

## Command contract

Public commands are hierarchical, contain no aliases or colon-separated names, and are generated from the SDK command-tree contract. The main resource groups are:

```text
trsd auth ...
trsd secrets ...
trsd agents ...
trsd providers ...
trsd capacity ...
trsd plans ...
trsd workdays ...
trsd assignments ...
trsd save
trsd stage
trsd release
trsd status
trsd diagnose
```

Run `trsd help <command path>` for leaf and intermediate-node help. The complete generated reference is in [`docs/command-reference.md`](docs/command-reference.md).

## Mutation behavior

- Read commands execute immediately.
- Mutations execute by default after any required confirmation.
- `--plan` returns the exact proposed mutation without performing it.
- `--yes` confirms authorized noninteractive work; it never bypasses API policy.
- `--json` emits the stable `treeseed.command-result/v1` envelope.

Examples:

```sh
trsd auth login --market local
trsd agents validate --project sdk --json
trsd capacity explain --team treeseed --json
trsd workdays profiles show balanced --team treeseed --json
trsd workdays plan --team treeseed --profile balanced --projects sdk --duration 3600 --json
trsd workdays start --team treeseed --preflight <id> --digest <sha256> --plan --json
```

With `TREESEED_CONTROL_PLANE_MODE=managed`, commands default to the local control-plane profile. `TREESEED_API_BASE_URL` must identify that API. An explicit `--market` still takes precedence.

## Workdays and capacity

A workday is a team-portfolio time, budget, provider, and allocation envelope. Repository-governed profiles divide capacity among agent classes with minimum, target, maximum, and audited borrowing rules. The API compiles eligible demand and provider availability into an immutable preflight receipt. `workdays start` consumes that exact receipt and fails if its inputs changed.

Capacity plans are API-derived records. The CLI can list, show, explain, and compare them, but cannot create or edit their content. Acting assignments still require approved decision authority; planning and research demand follow the selected workday profile.

## Providers and agents

Agent definitions, classes, and bindings are repository-governed content indexed by the API. CLI commands inspect and diagnose the accepted generation; definition changes flow through GitHub branches and pull requests.

Provider credentials and host authority remain outside agent workspaces. `providers connect` is the high-level bootstrap surface; the Agent package's low-level provider executable is private to trusted runtime containers.

## Generated automation artifacts

The build generates all public interface artifacts from the same SDK command tree:

- `docs/command-reference.md`
- `schemas/command-tree.json`
- `schemas/command-tree.schema.json`
- `schemas/command-result.schema.json`
- `completions/trsd.bash`

The package exports only its root module. Internal handler and runtime paths are not public API.

## Development

```sh
npm ci
npm run lint
npm test
npm run release:verify
npm pack --json --ignore-scripts
```

The release gate builds generated artifacts, runs the retained deterministic suite, packs the package, installs it in isolation, asserts that only `trsd` is present, and exercises the installed command tree.

This prerelease cutover keeps production and unscoped release fail-closed. GitHub-backed `save`, `stage`, and `release` execution remains unavailable until the corresponding trusted work-provider routes are active.
