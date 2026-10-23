# Cordis diagnostic executable

`trsd-linux-x64` is a standalone Task1 diagnostic front door. Run it without Node/Bun or a
project checkout. Supported commands:

```text
trsd --help
trsd --version
trsd doctor [--json] [--context NAME] [--installation ABSOLUTE_PATH] [--port INTEGER]
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
3 unmet prerequisites or explicitly unsupported platform/lifecycle commands. `platform`,
`plan`, `apply`, `status`, `install`, `open`, `recover` and lifecycle verbs are unsupported,
not simulated successful operations. SDK seven-operation bindings are contract-only.
Duplicate/missing flags and positional arguments fail validation. JSON is supported only on
doctor, including its validation failures. Version is `trsd 0.0.0-cordis.1`.

`CliProgramFixture.run(args)` spawns the compiled artifact with closed stdin, captures output
and exit status, and supports fixture cwd/environment. Acceptance covers another directory,
spaces, symlink, no runtime PATH, cwd .env/bunfig isolation, wrong engine, foreign destination,
missing prerequisites and occupied ports. Default construction also exercises real collaborators.
The build disables dotenv and bunfig autoloading in the compiled executable; see
[Bun executables](https://bun.com/docs/bundler/executables).

Legacy ownership: CLI main/runtime/operator remains in CLI. This slice adds only argument,
output and diagnostic execution. Remote transport and all lifecycle mutation are deferred.

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
