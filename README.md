# Cordis executable

`trsd-linux-x64` is the standalone diagnostic, planning and installed-operation front door. Run it without Node/Bun or a
project checkout. Supported commands:

```text
trsd --help
trsd --version
trsd doctor [--json] [--context NAME] [--installation ABSOLUTE_PATH] [--port INTEGER]
trsd platform plan --file CONFIG [--json]
trsd platform apply --installation DIR --plan ID --digest SHA --idempotency-key KEY [--json]
trsd platform status --installation DIR [--json]
trsd platform application --installation DIR --id ID [--json]
```

`CliApplication` parses arguments and calls the public packaged `DeploymentHost` contract;
its default constructor uses `ComposeDeploymentHost`. `CliOutput` owns rendering. Help/version
never probe the engine or write state. Doctor is read-only apart from a short-lived loopback
port probe. It creates no configuration, credentials, installation directories or containers.
The first target is Ubuntu26.04 x64; doctor reports unsupported hosts truthfully.

JSON stdout is exactly one envelope: command, success, result, problem, blockers, references.
Doctor result follows the SDK DiagnosticReport schema. Human output uses concise checks;
human errors go to stderr. Errors never echo unknown argument values or raw Docker stderr.
Exit0 means success;1 runtime failure;2 invalid command/flag/value (with actionable help);
3 unmet prerequisites or explicitly unsupported lifecycle commands. Implemented platform bindings
are `plan`, `apply`, `status` and `application` read-back. Apply acknowledges durable acceptance;
application/status determine readiness. `plugin install`, `open` and `recover` remain unsupported
in this candidate. Remote SDK bindings remain contract-only.
Duplicate/missing flags and positional arguments fail validation. JSON is supported on doctor and
implemented platform commands, including validation failures. Version is `trsd 0.0.0-cordis.6`.

This candidate consumes exact SDK `.12`, UI `.14` and Deployment `.24` archives. Source/byte
receipts are recorded in `package.json.cordisCandidate`, the lockfile and vendor archives.
Human presentation stays UI-owned and machine envelopes/exit codes stay CLI-owned. Default
Deployment selects the saved installation format; format-3 application and readonly observations
use its native standalone host without an ambient Node/Bun/package manager during apply.

`CliProgramFixture.run(args)` spawns the compiled artifact with closed stdin, captures output
and exit status, and supports fixture cwd/environment. Acceptance covers another directory,
spaces, symlink, no runtime PATH, cwd .env/bunfig isolation, wrong engine, foreign destination,
missing prerequisites and occupied ports. Default construction also exercises real collaborators.
The build disables dotenv and bunfig autoloading in the compiled executable; see
[Bun executables](https://bun.com/docs/bundler/executables).

Legacy ownership: CLI main/runtime/operator remains in CLI. This slice owns argument, output and diagnostic/planning execution. Remote transport and activation are deferred.

## Development and candidate delivery

Use Bun 1.4.4, TypeScript 5.9.3, Zod 4.6.7 and Node 24.19.0 for portability qualification.
Run `bun install --frozen-lockfile`, `bun run check`, `bun run build`, then
`bun run test:unit`, `bun run test:integration`, `bun run test:smoke`.
`bun run verify` runs all of these in order. No empty suites or skipped targets count as qualification.
The first executable target is Ubuntu 26.04 x64 with a local Linux/amd64 Docker engine.
Other operating systems/architectures remain unqualified. Cordis upstream candidate:
`35fdc969e4b6c48c48ed44717c7a018324e4dd88`; this slice does not mount a Cordis host.

The SDK's `SourcePolicy` development export checks the actual TypeScript AST and strict
compiler diagnostics before every build. Handwritten JavaScript, standalone functions,
function expressions/arrows, object method bags and source imports escaping the owner
are rejected. Class methods, interfaces and declarative data/schemas are supported.
Inherited `.agents` upstream resources and generated `dist`/`vendor` archives are excluded.
See [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).

Private `0.0.0-cordis.1` candidates are packed without lifecycle scripts. Consumer `vendor/`
archives contain the exact generated package bytes, with source commit and SHA256 in
`package.json` and installation integrity in `bun.lock`. Consumers use public package exports,
never sibling source. These are review candidates, with no registry publication or production
release. Migration PRs target `cordis`; issues remain open until authorized release.

## Task 2: non-activating plans

`trsd platform plan --file CONFIG [--json]` validates an explicitly prepared local release bundle. It never downloads, installs packages, imports plugin code, runs scripts, binds ports, loads images, creates credentials or starts containers. Apply remains unsupported. Successful plans describe future effects, not an active or healthy installation.

Configuration retains installationId, engineContext, installationDirectory (absolute), origin (loopback), runtimeState, plugins (exact id/package/version/archive SHA-256) and credentialReferences (unique `secret://<slot>` values). Add `release: {directory: ABSOLUTE_PATH, manifestDigest: SHA256}`. The installation and bundle must be disjoint. JSON object keys and semantic sets normalize deterministically; artifact byte identities remain exact.

The SDK release inventory version 1 binds `packageJson`, `lockfile`, and `recipe` descriptors `{path,sha256}`, requiredPluginIds/requiredServices, package entries `{name,version,path,sha256}` and image entries `{id,reference,layout,indexSha256,manifestDigest}`. All paths inside the inventory are relative and contained without symlinks. Image references are digest-only and match the selected OCI manifest. Package archives exactly cover the flat locked runtime closure; Bun v2 registry and local tarball records are accepted, without resolving versions or contacting a registry. Unsupported lock forms fail closed. Selected plugin package metadata is produced from the SDK PluginDefinition declaration also used for class static provide/inject fields.

The recipe is a restricted Compose JSON object with services/volumes/secrets. Service fields: image, depends_on (names), ports (long-form target/published/host_ip/protocol tcp), volumes (type volume/source/target/read_only) and secrets (names). Exactly one published port matches origin; localhost maps to 127.0.0.1, IPv6 literals to ::1. Volume declarations are empty local objects; secret declarations are `{file: '.cordis/credentials/<slot>'}` and match configuration references bijectively. No command/entrypoint/environment/build/include/interpolation/host mount/custom network/privileged/external/hook fields. Named resources derive from `cordis-` plus the first 16 hex SHA-256 characters of canonical `{installationId,installationDirectory}`.

Deployment validates native Ubuntu 26.04 x64, local Docker Linux amd64 context/endpoint/daemon identity, capacity, ownership and ports. Port checks read Linux TCP tables without binding. Existing project containers/networks/volumes block; planning adopts no runtime. Only fresh/empty owned installation directories or valid owner-private plan-only state are accepted.

Plans bind normalized configuration, configuration/release/lock/recipe digests, expected engine, expectedComposition null, exact package/image artifacts and typed future effects. No timestamps or volatile capacity samples enter the digest. ID is `plan-<digest>`. Only unblocked plans are persisted under installation/.cordis (0700 directories, 0600 records), with no-overwrite atomic publication and verified read-back. Descriptor-anchored access rejects symlinks and unsafe ownership/permissions. Repetition revalidates inputs before byte-identical reuse. Interrupted/foreign/malformed state blocks; no automatic adoption or repair. Stored read-back does not require the source bundle, and grants no permission to apply.

CLI exits: 0 verified saved plan; 1 sanitized runtime/I/O failure; 2 invalid arguments/JSON/schema; 3 prerequisites/artifact/authority/state blockers. Blocked responses have result null, structured blockers and no saved reference. Never echo invalid input, archive content, credentials or engine stderr. SDK PlanningBlockedError carries only validated safe blockers. Seven remote operation IDs remain unchanged; platform.plan stays a write operation because saving a plan needs local ownership.

Verification: documentation first; outside-in built-program failure before implementation; exact read-back/modes/determinism; immutable/architecture/graph/recipe/secret/path/journal negative cases; no-runtime snapshots; actual default construction; all owner check/build/unit/integration/smoke gates plus assembled acceptance. Test fixtures are not a production application composition. CI must run a positive plan on ubuntu-26.04 and fail visibly if prerequisites are absent. These Task 2 planning scenes start no containers. Task 3C installed-operation acceptance below uses isolated, disposable fixture services.

Tracked in #311; parent integration treeseed-ai/platform#697. Issues remain open until authorized release.

Docker-backed integration/program tests have 30/60-second harness budgets to cover multiple bounded queries on cold CI runners. Individual runtime Docker commands retain their five-second timeout; missing prerequisites still fail the positive planning gate.

Planning accepts owned installation paths containing spaces and Unicode, including a directory that does not exist yet. A path accepted by the configuration contract must not be created and then rejected as an artifact filename.

## Task 3A: native CLI composition

Implementation is authorized in #313. CliApplication becomes a real native Cordis composition
root with typed command, configuration and output services. The default Deployment service
comes from the public Deployment package's native plugin registrations, not a direct
ComposeDeploymentHost constructor in the CLI. Every invocation disposes its root and leases;
help/version still need no engine access or writes. A minimal fixed emergency renderer may
report failure when even root construction fails; it cannot replace normal output selection.

For Task 3A qualification only, doctor and platform plan additionally accept
`--composition ABSOLUTE_MANIFEST --composition-digest SHA256`. Both are required together,
are explicit trusted local owner input, and select an already-prepared provider of the
DeploymentHost capability. Neither flag installs, downloads, builds or creates provider state.
The immutable owned/private manifest/package closure is verified through the SDK runtime's
single reviewed loader before class imports. Package capability/contract mismatches must be
rejected before evaluating the entry module, including top-level code. Unknown/duplicate flags or invalid command-configuration JSON/schema
are exit 2; prepared-provider artifact/metadata failures are exit 3; identity/ownership/selection blockers are safe exit 3; lifecycle failures are 1.
Never echo source bytes, raw exceptions or credentials. Existing envelope fields remain.

The fixture provider must implement the same Deployment contract, native provide/inject fields
and pinned contract 0.3.0-cordis.1, exporting its class and declaration from its verified entry.
The resulting generation binds scope, provider declaration, exact external file inventory and
configuration. It can identify its generation through ordinary diagnostic checks; no test-only
remote operation is added. Default construction still uses real packaged providers. Tests
exercise two implementations, true native service/root identity, ordinary ESM dependencies,
foreign cwd/spaces/Unicode/symlink executable/no-Node-or-Bun PATH, tampering/missing dependency,
constructor/disposer errors, and repeated invocation cleanup. Task 1–2 built-program results
remain the compatibility gate. Package candidate becomes 0.0.0-cordis.3.

This does not implement `trsd plugin install`, provider hot switching, apply, API transport or
new installation state. Those retain their approved later-slice gates.

The standalone build enables `compile.autoloadPackageJson` for native resolution of the
verified external package closure, while disabling dotenv, bunfig and tsconfig autoload.
This is required by Bun 1.4.4; [Bun documents the flag](https://bun.sh/docs/bundler/executables#automatic-config-loading)
and its [maintainer identifies it for external modules](https://github.com/oven-sh/bun/issues/27058).
The built-program canary verifies cwd package metadata cannot redirect core behavior or run scripts.

## Task 3B: Installed application commands

platform apply --installation DIR --plan ID --digest SHA --idempotency-key KEY --json submits through the selected public Deployment capability. platform status --installation DIR --json and platform application --installation DIR --id ID --json read durable state. Exit zero for apply means accepted, not ready. The same standalone executable contains a fixed internal worker entry; it accepts only validated private installation state. No CLI-owned controller, provider catalog or concrete Deployment construction is introduced.

Task 3B is authorized after the maintainer reviewed the isolated setup. Tracking: #315. Detailed integration plan: https://github.com/treeseed-ai/platform/blob/cordis/docs/superpowers/plans/2026-10-24-task3b-installed-composition.md. Implementation evidence is recorded separately; these requirements are not a passing-test claim.

Development: Bun 1.4.4, Node 24.19.0, TypeScript 5.9.3, native Cordis 4.0.0-rc.12. Run bun run verify (semantic class/source check, strict compiler, build and nonempty unit/integration/program smoke). Installed acceptance uses genuine exact package/OCI bytes, real identity/database/API/HTTPS and explicit isolated certificate trust. No global trust mutation or legacy service changes. All handwritten source, tools and tests are strict TypeScript classes.

All capabilities that can be plugins, including container services, are native Cordis class plugins with typed swappable contracts. No parallel DI graph. Keep independent repository/public package boundaries, exact archive pins and original licenses. Migration PRs target cordis with Part of issue references. All issues remain open until authorized release; installer/Agent/generalized recovery are later tasks.

## Task 3C contract

Owner issue: https://github.com/treeseed-ai/cli/issues/317. Follow the approved Platform Task 3C service/provider/UI plan through exact public archives. Preserve independent repository ownership, strict TypeScript classes, native Cordis lifecycle, historical formats and all seven SDK operations. Expected-generation/idempotency, resource/credential/TLS retention and explicit unsafe restart/migration gates are mandatory. All issues remain open until release.

Every visual component must be mobile-first from 320 CSS pixels to widescreen monitors; test 320/375/768/1024/1440/1920/2560 widths, long content, keyboard/touch and 200% text resizing. Keep authored controls at least 44×44 CSS pixels, required actions visible, logical/fluid dimensions and no page overflow (labeled local semantic-table overflow is permitted). UI owns components/styles/renderers; consumers retain domain behavior and Identity retains Keycloak authority.

### Reusable terminal presentation

Human output maps diagnostics, plans, installation state, applications and safe errors into
UI-owned text/status/table/feedback/stack view models. The native CLI output plugin consumes
UI's public terminal renderer; formatting and reusable presentation live in UI. Human plan
output contains explicit service, volume, port and future-effect tables. JSON envelope bytes,
exit meanings and stdout/stderr ownership stay with CLI; machine JSON does not create a UI
scope. Built-program tests use an empty or Docker-only PATH and retain Task 1 checks.

Configuration and output accept the new format-3 service contracts through exact public
SDK/Deployment archives, preserving historical format-1/2 input/readers. This presentation
slice adds no installer commands or activation policy; those follow under this same Task 3C.

### Built format-3 acceptance gate

Owner CI runs on Ubuntu 26.04 with `CORDIS_REQUIRE_PLAN=1`: missing prerequisites fail visibly.
The built standalone CLI plans a genuine prepared five-instance bundle through Deployment's
public fixture/export, saves and repeats identical format-3 bytes, renders reusable human
service tables and runs with Docker-only PATH. It leaves Docker resources, listeners,
credentials and the import/script canary unchanged. Tampered input returns a blocked envelope
without a saved reference. These are planning checks, not installed activation evidence.


## Built format-3 installed-operation qualification

The real `trsd` executable must plan a genuine prepared format-3 fixture bundle, submit its exact
saved plan, recover the same application after the submitting CLI process exits, and read status
and application through the durable standalone Deployment worker. The bundle contains a worker
produced before planning through Deployment's public `ServiceWorkerBuild`; CLI neither builds a
worker during apply nor implements a second coordinator. Apply/status/application run from a
foreign directory with only Docker on PATH, closed stdin and the executable reached by symlink.

Exit zero from apply remains durable acceptance. Only subsequent verified application/status
read-back establishes readiness. Repeated submission with the same idempotency key returns the
same application, including after the source bundle is removed. JSON continues through SDK
schemas; human output continues through UI terminal providers. Qualification creates and cleans
only uniquely labelled fixture containers/volumes/networks and its exact selected worker process.
Graceful worker disposal preserves installed resources; a later apply must report repair rather
than silently restart that worker. Original services remain outside this fixture.
