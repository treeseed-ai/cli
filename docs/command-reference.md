# TreeSeed CLI command reference

This file is generated from the accepted `@treeseed/sdk/operator-contracts` command tree. Do not edit it by hand.

## trsd auth

Auth operations.

### trsd auth login

Login the selected resource.

Operation: mutation. Result schema: `treeseed.command.login/v1`.
Execution: `protocol.oauth.device.login`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd auth logout

Logout the selected resource.

Operation: mutation. Result schema: `treeseed.command.logout/v1`.
Execution: `protocol.oauth.revoke`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd auth status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Control-plane operation: `accounts.current.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd secrets

Secrets operations.

### trsd secrets list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Execution: `local.secrets.list`.

- `--json`: Emit the stable JSON envelope.

### trsd secrets status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.secrets.status`.

- `--json`: Emit the stable JSON envelope.

### trsd secrets unlock

Unlock the selected resource.

Operation: mutation. Result schema: `treeseed.command.unlock/v1`.
Execution: `local.secrets.unlock`.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd secrets lock

Lock the selected resource.

Operation: mutation. Result schema: `treeseed.command.lock/v1`.
Execution: `local.secrets.lock`.

- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd secrets rotate

Rotate the selected resource.

Operation: mutation. Result schema: `treeseed.command.rotate/v1`.
Execution: `local.secrets.rotate`.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd agents

Agents operations.

### trsd agents list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `agents.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd agents show <agent>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `agents.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd agents validate

Validate the selected resource.

Operation: read. Result schema: `treeseed.command.validate/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd agents diff

Diff the selected resource.

Operation: read. Result schema: `treeseed.command.diff/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd agents diagnose

Diagnose the selected resource.

Operation: read. Result schema: `treeseed.command.diagnose/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

## trsd agents classes

Classes operations.

### trsd agents classes list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `agents.classes.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd agents classes show <class>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `agents.classes.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

## trsd agents bindings

Bindings operations.

### trsd agents bindings list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd agents bindings show <binding>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd agents bindings explain <binding>

Explain the selected resource.

Operation: read. Result schema: `treeseed.command.explain/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

## trsd providers

Providers operations.

### trsd providers list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `providers.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd providers show <provider>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `providers.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers status <provider>

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Control-plane operation: `providers.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers diagnose <provider>

Diagnose the selected resource.

Operation: read. Result schema: `treeseed.command.diagnose/v1`.
Control-plane operation: `providers.diagnose`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers connect

Connect the selected resource.

Operation: mutation. Result schema: `treeseed.command.connect/v1`.
Control-plane operation: `providers.connect`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd providers disconnect <connection>

Disconnect the selected resource.

Operation: mutation. Result schema: `treeseed.command.disconnect/v1`.
Control-plane operation: `providers.disconnect`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd providers requests

Requests operations.

### trsd providers requests list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `providers.requests.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd providers requests show <request>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `providers.requests.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers requests approve <request>

Approve the selected resource.

Operation: mutation. Result schema: `treeseed.command.approve/v1`.
Control-plane operation: `providers.requests.approve`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd providers requests reject <request>

Reject the selected resource.

Operation: mutation. Result schema: `treeseed.command.reject/v1`.
Control-plane operation: `providers.requests.reject`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd providers credentials

Credentials operations.

### trsd providers credentials status <connection>

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Control-plane operation: `providers.credentials.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers credentials rotate <connection>

Rotate the selected resource.

Operation: mutation. Result schema: `treeseed.command.rotate/v1`.
Control-plane operation: `providers.credentials.rotate`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd providers credentials revoke <connection>

Revoke the selected resource.

Operation: mutation. Result schema: `treeseed.command.revoke/v1`.
Control-plane operation: `providers.credentials.revoke`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd providers offers

Offers operations.

### trsd providers offers show <connection>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd providers offers validate <file>

Validate the selected resource.

Operation: read. Result schema: `treeseed.command.validate/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd providers offers plan <file>

Plan the selected resource.

Operation: read. Result schema: `treeseed.command.plan/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd providers offers apply <file>

Apply the selected resource.

Operation: mutation. Result schema: `treeseed.command.apply/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd seeds

Seeds operations.

### trsd seeds validate <file>

Validate the selected resource.

Operation: read. Result schema: `treeseed.command.validate/v1`.
Control-plane operation: `seeds.validate`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd seeds plan <file>

Plan the selected resource.

Operation: read. Result schema: `treeseed.command.plan/v1`.
Control-plane operation: `seeds.plan`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd seeds apply <file>

Apply the selected resource.

Operation: mutation. Result schema: `treeseed.command.apply/v1`.
Control-plane operation: `seeds.apply`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd seeds show <seed>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `seeds.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd seeds verify <seed>

Verify the selected resource.

Operation: read. Result schema: `treeseed.command.verify/v1`.
Control-plane operation: `seeds.verify`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd capacity

Capacity operations.

### trsd capacity status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Control-plane operation: `capacity.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd capacity explain

Explain the selected resource.

Operation: read. Result schema: `treeseed.command.explain/v1`.
Control-plane operation: `capacity.explain`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd capacity usage

Usage the selected resource.

Operation: read. Result schema: `treeseed.command.usage/v1`.
Control-plane operation: `capacity.usage`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd capacity ledger

Ledger the selected resource.

Operation: read. Result schema: `treeseed.command.ledger/v1`.
Control-plane operation: `capacity.ledger`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd capacity audit

Audit the selected resource.

Operation: read. Result schema: `treeseed.command.audit/v1`.
Control-plane operation: `capacity.audit`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

## trsd plans

Plans operations.

### trsd plans list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `plans.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--decision <value>`: Approved decision identity.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd plans show <plan>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `plans.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd plans explain <plan>

Explain the selected resource.

Operation: read. Result schema: `treeseed.command.explain/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd plans diff <left> <right>

Compare two API-derived plans.

Operation: read. Result schema: `treeseed.command.plans.diff/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

## trsd workdays

Workdays operations.

## trsd workdays profiles

Profiles operations.

### trsd workdays profiles list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd workdays profiles show <profile>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd workdays profiles validate <file>

Validate the selected resource.

Operation: read. Result schema: `treeseed.command.validate/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd workdays plan

Plan the selected resource.

Operation: mutation. Result schema: `treeseed.command.plan/v1`.
Control-plane operation: `workdays.plan`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--profile <value>`: Workday profile identity.
- `--projects <value>`: Project scope or comma-separated projects.
- `--start <value>`: ISO start time.
- `--end <value>`: ISO end time.
- `--duration <value>`: Duration in seconds.
- `--objective <value>`: Objective filter.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays start

Start the selected resource.

Operation: mutation. Result schema: `treeseed.command.start/v1`.
Control-plane operation: `workdays.start`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--preflight <value>`: Exact preflight identity.
- `--digest <value>`: Exact preflight digest.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `workdays.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd workdays show <workday>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `workdays.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd workdays watch <workday>

Watch the selected resource.

Operation: read. Result schema: `treeseed.command.watch/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd workdays pause <workday>

Pause the selected resource.

Operation: mutation. Result schema: `treeseed.command.pause/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays resume <workday>

Resume the selected resource.

Operation: mutation. Result schema: `treeseed.command.resume/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays stop <workday>

Stop the selected resource.

Operation: mutation. Result schema: `treeseed.command.stop/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays cancel <workday>

Cancel the selected resource.

Operation: mutation. Result schema: `treeseed.command.cancel/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd workdays schedules

Schedules operations.

### trsd workdays schedules list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `workdays.schedules.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd workdays schedules show <schedule>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd workdays schedules plan

Plan the selected resource.

Operation: read. Result schema: `treeseed.command.plan/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd workdays schedules start

Start the selected resource.

Operation: mutation. Result schema: `treeseed.command.start/v1`.
Control-plane operation: `workdays.schedules.create`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--profile <value>`: Workday profile identity.
- `--projects <value>`: Project scope or comma-separated projects.
- `--duration <value>`: Duration in seconds.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays schedules pause <schedule>

Pause the selected resource.

Operation: mutation. Result schema: `treeseed.command.pause/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays schedules resume <schedule>

Resume the selected resource.

Operation: mutation. Result schema: `treeseed.command.resume/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays schedules retire <schedule>

Retire the selected resource.

Operation: mutation. Result schema: `treeseed.command.retire/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd assignments

Assignments operations.

### trsd assignments list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `assignments.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd assignments show <assignment>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `assignments.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd assignments explain <assignment>

Explain the selected resource.

Operation: read. Result schema: `treeseed.command.explain/v1`.
Control-plane operation: `assignments.explain`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd assignments watch <assignment>

Watch the selected resource.

Operation: read. Result schema: `treeseed.command.watch/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

### trsd assignments retry <assignment>

Retry the selected resource.

Operation: mutation. Result schema: `treeseed.command.retry/v1`.
Control-plane operation: `assignments.retry`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd assignments cancel <assignment>

Cancel the selected resource.

Operation: mutation. Result schema: `treeseed.command.cancel/v1`.
Control-plane operation: `assignments.cancel`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd assignments artifacts <assignment>

Artifacts the selected resource.

Operation: read. Result schema: `treeseed.command.artifacts/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.

## trsd projects

Projects operations.

## trsd projects treedx

Treedx operations.

### trsd projects treedx show <project>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `treedx.library.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd projects treedx bind <project>

Bind the selected resource.

Operation: mutation. Result schema: `treeseed.command.bind/v1`.
Control-plane operation: `treedx.library.bind`.

- `--server <value>`: Control-plane server profile or URL.
- `--connection <value>`: Trusted service connection identity.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd projects treedx status <project>

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Control-plane operation: `treedx.health.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd projects treedx diagnose <project>

Diagnose the selected resource.

Operation: read. Result schema: `treeseed.command.diagnose/v1`.
Control-plane operation: `treedx.service.contract`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd projects treedx capabilities <project>

Capabilities the selected resource.

Operation: read. Result schema: `treeseed.command.capabilities/v1`.
Control-plane operation: `treedx.capabilities.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd projects treedx workspaces

Workspaces operations.

### trsd projects treedx workspaces list <project>

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `treedx.workspaces.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd projects treedx workspaces show <workspace>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `treedx.workspaces.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd projects treedx workspaces abandon <workspace>

Abandon the selected resource.

Operation: mutation. Result schema: `treeseed.command.abandon/v1`.
Control-plane operation: `treedx.workspaces.abandon`.

- `--server <value>`: Control-plane server profile or URL.
- `--project <value>`: Project id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd save

Save the selected resource.

Operation: mutation. Result schema: `treeseed.command.save/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). Unified GitHub-backed save is intentionally fail-closed during this cutover.

- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd stage

Stage the selected resource.

Operation: mutation. Result schema: `treeseed.command.stage/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). Unified GitHub-backed stage is intentionally fail-closed during this cutover.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd release

Release the selected resource.

Operation: mutation. Result schema: `treeseed.command.release/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). Production release is intentionally fail-closed during this cutover.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Control-plane operation: `status.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd diagnose

Diagnose the selected resource.

Operation: read. Result schema: `treeseed.command.diagnose/v1`.
Availability: fail-closed (`standards_migration_not_enabled`). This capability is not enabled until its control-plane operation is accepted.

- `--json`: Emit the stable JSON envelope.
