# TreeSeed CLI command reference

This file is generated from the accepted `@treeseed/sdk/operator-contracts` command tree. Do not edit it by hand.

## trsd auth

Auth operations.

### trsd auth login

Login the selected resource.

Operation: mutation. Result schema: `treeseed.command.login/v1`.

- `--market <value>`: Control-plane profile.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd auth logout

Logout the selected resource.

Operation: mutation. Result schema: `treeseed.command.logout/v1`.

- `--market <value>`: Control-plane profile.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd auth status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.

- `--market <value>`: Control-plane profile.
- `--json`: Emit the stable JSON envelope.

## trsd secrets

Secrets operations.

### trsd secrets list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd secrets status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.

- `--json`: Emit the stable JSON envelope.

### trsd secrets unlock

Unlock the selected resource.

Operation: mutation. Result schema: `treeseed.command.unlock/v1`.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd secrets lock

Lock the selected resource.

Operation: mutation. Result schema: `treeseed.command.lock/v1`.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd secrets rotate

Rotate the selected resource.

Operation: mutation. Result schema: `treeseed.command.rotate/v1`.

- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd agents

Agents operations.

### trsd agents list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd agents show <agent>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd agents validate

Validate the selected resource.

Operation: read. Result schema: `treeseed.command.validate/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd agents diff

Diff the selected resource.

Operation: read. Result schema: `treeseed.command.diff/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd agents diagnose

Diagnose the selected resource.

Operation: read. Result schema: `treeseed.command.diagnose/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

## trsd agents classes

Classes operations.

### trsd agents classes list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd agents classes show <class>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

## trsd agents bindings

Bindings operations.

### trsd agents bindings list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd agents bindings show <binding>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd agents bindings explain <binding>

Explain the selected resource.

Operation: read. Result schema: `treeseed.command.explain/v1`.

- `--market <value>`: Control-plane profile.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

## trsd providers

Providers operations.

### trsd providers list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd providers show <provider>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers status <provider>

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers diagnose <provider>

Diagnose the selected resource.

Operation: read. Result schema: `treeseed.command.diagnose/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--json`: Emit the stable JSON envelope.

### trsd providers connect

Connect the selected resource.

Operation: mutation. Result schema: `treeseed.command.connect/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--provider <value>`: Provider identity.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd providers disconnect <connection>

Disconnect the selected resource.

Operation: mutation. Result schema: `treeseed.command.disconnect/v1`.

- `--market <value>`: Control-plane profile.
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

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd providers requests show <request>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers requests approve <request>

Approve the selected resource.

Operation: mutation. Result schema: `treeseed.command.approve/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd providers requests reject <request>

Reject the selected resource.

Operation: mutation. Result schema: `treeseed.command.reject/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd providers credentials

Credentials operations.

### trsd providers credentials status <connection>

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers credentials rotate <connection>

Rotate the selected resource.

Operation: mutation. Result schema: `treeseed.command.rotate/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd providers credentials revoke <connection>

Revoke the selected resource.

Operation: mutation. Result schema: `treeseed.command.revoke/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--credential <value>`: Credential identity.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd providers offers

Offers operations.

### trsd providers offers show <connection>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers offers validate <file>

Validate the selected resource.

Operation: read. Result schema: `treeseed.command.validate/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers offers plan <file>

Plan the selected resource.

Operation: read. Result schema: `treeseed.command.plan/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd providers offers apply <file>

Apply the selected resource.

Operation: mutation. Result schema: `treeseed.command.apply/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd capacity

Capacity operations.

### trsd capacity status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd capacity explain

Explain the selected resource.

Operation: read. Result schema: `treeseed.command.explain/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd capacity usage

Usage the selected resource.

Operation: read. Result schema: `treeseed.command.usage/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd capacity ledger

Ledger the selected resource.

Operation: read. Result schema: `treeseed.command.ledger/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd capacity audit

Audit the selected resource.

Operation: read. Result schema: `treeseed.command.audit/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

## trsd plans

Plans operations.

### trsd plans list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--decision <value>`: Approved decision identity.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd plans show <plan>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd plans explain <plan>

Explain the selected resource.

Operation: read. Result schema: `treeseed.command.explain/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd plans diff <left> <right>

Compare two API-derived plans.

Operation: read. Result schema: `treeseed.command.plans.diff/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

## trsd workdays

Workdays operations.

## trsd workdays profiles

Profiles operations.

### trsd workdays profiles list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd workdays profiles show <profile>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd workdays profiles validate <file>

Validate the selected resource.

Operation: read. Result schema: `treeseed.command.validate/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd workdays plan

Plan the selected resource.

Operation: read. Result schema: `treeseed.command.plan/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--profile <value>`: Workday profile identity.
- `--projects <value>`: Project scope or comma-separated projects.
- `--start <value>`: ISO start time.
- `--end <value>`: ISO end time.
- `--duration <value>`: Duration in seconds.
- `--objective <value>`: Objective filter.
- `--json`: Emit the stable JSON envelope.

### trsd workdays start

Start the selected resource.

Operation: mutation. Result schema: `treeseed.command.start/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--preflight <value>`: Exact preflight identity.
- `--digest <value>`: Exact preflight digest.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd workdays show <workday>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd workdays watch <workday>

Watch the selected resource.

Operation: read. Result schema: `treeseed.command.watch/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd workdays pause <workday>

Pause the selected resource.

Operation: mutation. Result schema: `treeseed.command.pause/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays resume <workday>

Resume the selected resource.

Operation: mutation. Result schema: `treeseed.command.resume/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays stop <workday>

Stop the selected resource.

Operation: mutation. Result schema: `treeseed.command.stop/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays cancel <workday>

Cancel the selected resource.

Operation: mutation. Result schema: `treeseed.command.cancel/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd workdays schedules

Schedules operations.

### trsd workdays schedules list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd workdays schedules show <schedule>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd workdays schedules plan

Plan the selected resource.

Operation: read. Result schema: `treeseed.command.plan/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--profile <value>`: Workday profile identity.
- `--projects <value>`: Project scope or comma-separated projects.
- `--duration <value>`: Duration in seconds.
- `--json`: Emit the stable JSON envelope.

### trsd workdays schedules start

Start the selected resource.

Operation: mutation. Result schema: `treeseed.command.start/v1`.

- `--market <value>`: Control-plane profile.
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

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays schedules resume <schedule>

Resume the selected resource.

Operation: mutation. Result schema: `treeseed.command.resume/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd workdays schedules retire <schedule>

Retire the selected resource.

Operation: mutation. Result schema: `treeseed.command.retire/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd assignments

Assignments operations.

### trsd assignments list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd assignments show <assignment>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd assignments explain <assignment>

Explain the selected resource.

Operation: read. Result schema: `treeseed.command.explain/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd assignments watch <assignment>

Watch the selected resource.

Operation: read. Result schema: `treeseed.command.watch/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd assignments retry <assignment>

Retry the selected resource.

Operation: mutation. Result schema: `treeseed.command.retry/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd assignments cancel <assignment>

Cancel the selected resource.

Operation: mutation. Result schema: `treeseed.command.cancel/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--reason <value>`: Audited operator reason.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd assignments artifacts <assignment>

Artifacts the selected resource.

Operation: read. Result schema: `treeseed.command.artifacts/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd save

Save the selected resource.

Operation: mutation. Result schema: `treeseed.command.save/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd stage

Stage the selected resource.

Operation: mutation. Result schema: `treeseed.command.stage/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd release

Release the selected resource.

Operation: mutation. Result schema: `treeseed.command.release/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd diagnose

Diagnose the selected resource.

Operation: read. Result schema: `treeseed.command.diagnose/v1`.

- `--market <value>`: Control-plane profile.
- `--team <value>`: Team id or slug.
- `--project <value>`: Project id or slug.
- `--json`: Emit the stable JSON envelope.
