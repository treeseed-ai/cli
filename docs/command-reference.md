# TreeSeed CLI command reference

This file is generated from the accepted `@treeseed/sdk/operator-contracts` command tree. Do not edit it by hand.

### trsd inbox

Open the active team governance inbox.

Operation: read. Result schema: `treeseed.inbox-session/v1`.
Execution: `local.inbox`.

- `--json`: Emit the stable JSON envelope.
- `--project <value>`: Initial project filter.
- `--type <value>`: Initial proposal, question, or all filter.
- `--all`: Include completed and decided items.

### trsd send [channel] [message]

Send a message or open the interactive team topic browser.

Operation: mutation. Result schema: `treeseed.communication-send-receipt/v4`.
Control-plane operation: `communications.send`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--to <value>`: Deprecated validation-only address list.
- `--timeout <value>`: Optional maximum seconds to listen for the complete response chain.
- `--no-wait`: Return immediately after durable admission.
- `--wait <value>`: Deprecated wait duration in seconds.
- `--json-stream`: Emit ordered communication events as NDJSON.
- `--diagnostics <value>`: Diagnostic detail: metadata or full.

## trsd topics

Topics operations.

### trsd topics list

List discussion topics and active listeners.

Operation: read. Result schema: `treeseed.communication-topic-page/v1`.
Control-plane operation: `communications.topics.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd topics show <topic>

Show a discussion topic and its listeners.

Operation: read. Result schema: `treeseed.communication-topic/v1`.
Control-plane operation: `communications.topics.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.

### trsd topics subscribe <topic> <agent>

Subscribe an agent to a discussion topic.

Operation: mutation. Result schema: `treeseed.communication-topic-subscription-receipt/v1`.
Control-plane operation: `communications.topics.subscriptions.put`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd topics unsubscribe <topic> <agent>

Remove an agent subscription from a discussion topic.

Operation: mutation. Result schema: `treeseed.communication-topic-subscription-receipt/v1`.
Control-plane operation: `communications.topics.subscriptions.delete`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd auth

Auth operations.

### trsd auth login

Login the selected resource.

Operation: mutation. Result schema: `treeseed.command.login/v1`.
Execution: `protocol.oauth.device.login`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--timeout <value>`: Maximum seconds to wait for device authorization.

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

## trsd users

Users operations.

### trsd users create

Create a local TreeSeed user with a securely prompted password.

Operation: mutation. Result schema: `treeseed.command.create/v1`.
Execution: `protocol.accounts.create`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--email <value>`: Email address for the new user.
- `--username <value>`: Unique username for the new user.
- `--display-name <value>`: Human-readable display name.
- `--timeout <value>`: Maximum seconds to wait for registration.

## trsd teams

Teams operations.

### trsd teams list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `teams.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd teams current

Show the active team for this authenticated server session.

Operation: read. Result schema: `treeseed.command.teams.current/v1`.
Execution: `local.teams.current`.

- `--json`: Emit the stable JSON envelope.

### trsd teams use <team>

Select the active team for this authenticated server session.

Operation: mutation. Result schema: `treeseed.command.teams.use/v1`.
Execution: `local.teams.use`.

- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

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

## trsd dev

Dev operations.

## trsd dev session

Session operations.

### trsd dev session start <manifest>

Start a local development session.

Operation: mutation. Result schema: `treeseed.command.dev.start/v1`.
Execution: `local.dev.session.start`.

- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--actor <value>`: Audited development-session actor.
- `--lease-seconds <value>`: Requested bounded lease duration.

### trsd dev session stop

Stop a local development session.

Operation: mutation. Result schema: `treeseed.command.dev.stop/v1`.
Execution: `local.dev.session.stop`.

- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--session <value>`: Development session identity.
- `--restore`: Restore released routes and targets.

### trsd dev use <selection>

Use a local development session.

Operation: mutation. Result schema: `treeseed.command.dev.use/v1`.
Execution: `local.dev.use`.

- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--session <value>`: Development session identity.
- `--target <value>`: Additional project.target=mode selections.

### trsd dev rebuild <target>

Rebuild a local development session.

Operation: mutation. Result schema: `treeseed.command.dev.rebuild/v1`.
Execution: `local.dev.rebuild`.

- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--session <value>`: Development session identity.

### trsd dev status

Status a local development session.

Operation: read. Result schema: `treeseed.command.dev.status/v1`.
Execution: `local.dev.status`.

- `--json`: Emit the stable JSON envelope.
- `--session <value>`: Development session identity.
- `--all`: Include stopped and expired sessions.

### trsd dev logs

Logs a local development session.

Operation: read. Result schema: `treeseed.command.dev.logs/v1`.
Execution: `local.dev.logs`.

- `--json`: Emit the stable JSON envelope.
- `--session <value>`: Development session identity.
- `--target <value>`: Development target identity.
- `--follow`: Follow target logs.

### trsd dev plan

Plan a local development session.

Operation: read. Result schema: `treeseed.command.dev.plan/v1`.
Execution: `local.dev.plan`.

- `--json`: Emit the stable JSON envelope.
- `--session <value>`: Development session identity.
- `--affected`: Show the smallest affected closure.

### trsd dev freeze

Freeze a local development session.

Operation: mutation. Result schema: `treeseed.command.dev.freeze/v1`.
Execution: `local.dev.freeze`.

- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--session <value>`: Development session identity.
- `--allow-dirty`: Create a non-promotable dirty-source candidate.

### trsd dev verify

Verify a local development session.

Operation: mutation. Result schema: `treeseed.command.dev.verify/v1`.
Execution: `local.dev.verify`.

- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--session <value>`: Development session identity.
- `--candidate <value>`: Candidate identity.

## trsd host

Host operations.

### trsd host status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host doctor

Doctor the selected resource.

Operation: read. Result schema: `treeseed.command.doctor/v1`.
Execution: `local.host.doctor`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host plan

Plan the selected resource.

Operation: read. Result schema: `treeseed.command.plan/v1`.
Execution: `local.host.plan`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host apply

Apply the selected resource.

Operation: mutation. Result schema: `treeseed.command.apply/v1`.
Execution: `local.host.apply`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host reconcile

Reconcile the selected resource.

Operation: mutation. Result schema: `treeseed.command.reconcile/v1`.
Execution: `local.host.reconcile`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host events

Events the selected resource.

Operation: read. Result schema: `treeseed.command.events/v1`.
Execution: `local.host.events`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd host config

Config operations.

### trsd host config show

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Execution: `local.host.config.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host config plan <file>

Plan the selected resource.

Operation: read. Result schema: `treeseed.command.plan/v1`.
Execution: `local.host.config.plan`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host config apply <file>

Apply the selected resource.

Operation: mutation. Result schema: `treeseed.command.apply/v1`.
Execution: `local.host.config.apply`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host config adopt <file>

Adopt the selected resource.

Operation: mutation. Result schema: `treeseed.command.adopt/v1`.
Execution: `local.host.config.adopt`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--confirm`: Confirm replacement of the installed configuration identity.

### trsd host topology

Topology the selected resource.

Operation: read. Result schema: `treeseed.command.topology/v1`.
Execution: `local.host.topology`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host connections

Connections the selected resource.

Operation: read. Result schema: `treeseed.command.connections/v1`.
Execution: `local.host.connections`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd host provider

Provider operations.

### trsd host provider status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.provider.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd host storage

Storage operations.

### trsd host storage status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.storage.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host storage connect <backend>

Connect the selected resource.

Operation: mutation. Result schema: `treeseed.command.connect/v1`.
Execution: `local.host.storage.connect`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--account-id <value>`: Optional Cloudflare account ID when the bootstrap authority reaches multiple accounts.

### trsd host storage reconcile

Reconcile the selected resource.

Operation: mutation. Result schema: `treeseed.command.reconcile/v1`.
Execution: `local.host.storage.reconcile`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host storage rotate <backend>

Rotate the selected resource.

Operation: mutation. Result schema: `treeseed.command.rotate/v1`.
Execution: `local.host.storage.rotate`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd host security

Security operations.

### trsd host security plan

Plan the selected resource.

Operation: read. Result schema: `treeseed.command.plan/v1`.
Execution: `local.host.security.plan`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host security initialize

Initialize the encrypted provider volume, application keys, and offline recovery bundle.

Operation: mutation. Result schema: `treeseed.command.initialize/v1`.
Execution: `local.host.security.initialize`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--recovery-bundle <value>`: Absolute path for the new encrypted offline recovery bundle.
- `--confirm`: Confirm provider-state migration and volume formatting.

### trsd host security status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.security.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host security verify

Verify the selected resource.

Operation: read. Result schema: `treeseed.command.verify/v1`.
Execution: `local.host.security.verify`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host security rotate <target>

Rotate the selected resource.

Operation: mutation. Result schema: `treeseed.command.rotate/v1`.
Execution: `local.host.security.rotate`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--recovery-bundle <value>`: Absolute path to the currently authenticated recovery bundle.
- `--new-recovery-bundle <value>`: Absolute non-existing path for the replacement recovery bundle.
- `--confirm`: Confirm creation and activation of a new key generation.

## trsd host security recovery

Recovery operations.

### trsd host security recovery verify

Authenticate and inventory an offline recovery bundle without revealing secrets.

Operation: read. Result schema: `treeseed.host-recovery-verification/v1`.
Execution: `local.host.security.recovery.verify`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--bundle <value>`: Absolute recovery bundle path.

## trsd host sandbox

Sandbox operations.

### trsd host sandbox status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.sandbox.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host sandbox doctor

Doctor the selected resource.

Operation: read. Result schema: `treeseed.command.doctor/v1`.
Execution: `local.host.sandbox.doctor`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd host fleet

Fleet operations.

### trsd host fleet status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.fleet.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd host update

Update operations.

### trsd host update status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.update.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host update check

Check the selected resource.

Operation: mutation. Result schema: `treeseed.command.check/v1`.
Execution: `local.host.update.check`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host update apply

Apply the selected resource.

Operation: mutation. Result schema: `treeseed.command.apply/v1`.
Execution: `local.host.update.apply`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host update channel <track>

Channel the selected resource.

Operation: mutation. Result schema: `treeseed.command.channel/v1`.
Execution: `local.host.update.channel`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host update pause

Pause the selected resource.

Operation: mutation. Result schema: `treeseed.command.pause/v1`.
Execution: `local.host.update.pause`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host update resume

Resume the selected resource.

Operation: mutation. Result schema: `treeseed.command.resume/v1`.
Execution: `local.host.update.resume`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd host component

Component operations.

### trsd host component list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Execution: `local.host.component.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host component status <component>

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.component.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host component enable <component>

Enable the selected resource.

Operation: mutation. Result schema: `treeseed.command.enable/v1`.
Execution: `local.host.component.enable`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host component disable <component>

Disable the selected resource.

Operation: mutation. Result schema: `treeseed.command.disable/v1`.
Execution: `local.host.component.disable`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd host aliases

Aliases operations.

### trsd host aliases list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Execution: `local.host.aliases.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd host recovery

Recovery operations.

### trsd host recovery status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.recovery.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host recovery retry

Retry the selected resource.

Operation: mutation. Result schema: `treeseed.command.retry/v1`.
Execution: `local.host.recovery.retry`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host recovery restore <generation>

Restore the selected resource.

Operation: mutation. Result schema: `treeseed.command.restore/v1`.
Execution: `local.host.recovery.restore`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd host bootstrap

Bootstrap operations.

### trsd host bootstrap status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Execution: `local.host.bootstrap.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd host bootstrap enroll

Enroll the selected resource.

Operation: mutation. Result schema: `treeseed.command.enroll/v1`.
Execution: `local.host.bootstrap.enroll`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd host reset

Stop managed components, erase their state, and reconcile a fresh unseeded platform.

Operation: mutation. Result schema: `treeseed.command.reset/v1`.
Execution: `local.host.reset`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--confirm`: Confirm deletion of all manager-owned component data and receipts.

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

## trsd ai

Ai operations.

### trsd ai status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Control-plane operation: `treeai.qualification.get.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd ai mode

Mode operations.

### trsd ai mode show

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Execution: `local.host.ai.mode.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd ai mode set <mode>

Transition the exclusive AI GPU resource to awake or sleep.

Operation: mutation. Result schema: `treeseed.ai-mode-transition-receipt/v1`.
Execution: `local.host.ai.mode.set`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--idempotency-key <value>`: Replay-safe transition identity.
- `--drain-timeout <value>`: Maximum drain wait in seconds.

## trsd ai inference

Inference operations.

### trsd ai inference models

Models the selected resource.

Operation: read. Result schema: `treeseed.command.models/v1`.
Control-plane operation: `treeai.inference.get.models`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd ai inference jobs

Jobs the selected resource.

Operation: read. Result schema: `treeseed.command.jobs/v1`.
Control-plane operation: `treeai.inference.get.jobs`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd ai inference rollback

Rollback the selected resource.

Operation: mutation. Result schema: `treeseed.command.rollback/v1`.
Control-plane operation: `treeai.inference.post.deployments.rollback`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

## trsd ai training

Training operations.

### trsd ai training libraries

Libraries the selected resource.

Operation: read. Result schema: `treeseed.command.libraries/v1`.
Control-plane operation: `treeai.training.get.libraries`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd ai training jobs

Jobs the selected resource.

Operation: read. Result schema: `treeseed.command.jobs/v1`.
Control-plane operation: `treeai.training.get.jobs`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd ai training runs

Runs the selected resource.

Operation: read. Result schema: `treeseed.command.runs/v1`.
Control-plane operation: `treeai.training.get.library.runs`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd ai lab

Lab operations.

### trsd ai lab status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Control-plane operation: `treeai.lab.get.status`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd ai lab agents

Agents the selected resource.

Operation: read. Result schema: `treeseed.command.agents/v1`.
Control-plane operation: `treeai.lab.get.agents`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd ai lab libraries

Libraries the selected resource.

Operation: read. Result schema: `treeseed.command.libraries/v1`.
Control-plane operation: `treeai.lab.get.libraries`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd ai qualify

Qualify operations.

### trsd ai qualify status

Status the selected resource.

Operation: read. Result schema: `treeseed.command.status/v1`.
Control-plane operation: `treeai.qualification.get.qualification.profile`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd ai qualify run

Run the selected resource.

Operation: mutation. Result schema: `treeseed.command.run/v1`.
Control-plane operation: `treeai.qualification.post.qualification.campaigns`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.

### trsd ai qualify campaigns

Campaigns the selected resource.

Operation: read. Result schema: `treeseed.command.campaigns/v1`.
Control-plane operation: `treeai.qualification.get.qualification.campaigns`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

## trsd library

Library operations.

### trsd library show <project>

Show project library knowledge.

Operation: read. Result schema: `treeseed.command.library.show/v1`.
Execution: `local.library.show`.

- `--json`: Emit the stable JSON envelope.
- `--ref <value>`: Exact commit or protected library ref.

### trsd library status <project>

Status project library knowledge.

Operation: read. Result schema: `treeseed.command.library.status/v1`.
Execution: `local.library.status`.

- `--json`: Emit the stable JSON envelope.
- `--ref <value>`: Exact commit or protected library ref.

### trsd library paths <project>

Paths project library knowledge.

Operation: read. Result schema: `treeseed.command.library.paths/v1`.
Execution: `local.library.paths`.

- `--json`: Emit the stable JSON envelope.
- `--ref <value>`: Exact commit or protected library ref.
- `--prefix <value>`: Repository-relative path prefix.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.

### trsd library read <project> <path>

Read project library knowledge.

Operation: read. Result schema: `treeseed.command.library.read/v1`.
Execution: `local.library.read`.

- `--json`: Emit the stable JSON envelope.
- `--ref <value>`: Exact commit or protected library ref.

### trsd library search <project> <query>

Search project library knowledge.

Operation: read. Result schema: `treeseed.command.library.search/v1`.
Execution: `local.library.search`.

- `--json`: Emit the stable JSON envelope.
- `--ref <value>`: Exact commit or protected library ref.
- `--path <value>`: Restrict search to a repository-relative path.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.

### trsd library query <project> <query>

Query project library knowledge.

Operation: read. Result schema: `treeseed.command.library.query/v1`.
Execution: `local.library.query`.

- `--json`: Emit the stable JSON envelope.
- `--ref <value>`: Exact commit or protected library ref.
- `--model <value>`: TreeDX content model.
- `--input <value>`: YAML or JSON query body.

### trsd library context <project> <query>

Context project library knowledge.

Operation: read. Result schema: `treeseed.command.library.context/v1`.
Execution: `local.library.context`.

- `--json`: Emit the stable JSON envelope.
- `--ref <value>`: Exact commit or protected library ref.
- `--max-items <value>`: Maximum context items.
- `--max-tokens <value>`: Maximum context tokens.

## trsd library workspace

Workspace operations.

### trsd library workspace create <project>

Create the selected resource.

Operation: mutation. Result schema: `treeseed.command.create/v1`.
Control-plane operation: `knowledge.workspaces.create`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--request <value>`: Replay-safe UUID request identity.

### trsd library workspace show <workspace>

Show the selected resource.

Operation: read. Result schema: `treeseed.command.show/v1`.
Control-plane operation: `knowledge.workspaces.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd library workspace read <workspace> <path>

Read a file from a governed library workspace.

Operation: read. Result schema: `treeseed.command.library.workspace.read/v1`.
Control-plane operation: `knowledge.workspaces.content.show`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd library workspace diff <workspace>

Diff the selected resource.

Operation: read. Result schema: `treeseed.command.diff/v1`.
Control-plane operation: `knowledge.workspaces.diff`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.

### trsd library workspace write <workspace>

Write the selected resource.

Operation: mutation. Result schema: `treeseed.command.write/v1`.
Control-plane operation: `knowledge.workspaces.content.update`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--input <value>`: YAML or JSON draft body.

### trsd library workspace submit <workspace>

Submit the selected resource.

Operation: mutation. Result schema: `treeseed.command.submit/v1`.
Control-plane operation: `knowledge.workspaces.submit`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--version <value>`: Expected workspace version.
- `--message <value>`: Commit message.
- `--notes <value>`: Review notes.
- `--context-digest <value>`: Verified editorial context digest.

### trsd library workspace abandon <workspace>

Abandon the selected resource.

Operation: mutation. Result schema: `treeseed.command.abandon/v1`.
Control-plane operation: `knowledge.workspaces.abandon`.

- `--server <value>`: Control-plane server profile or URL.
- `--yes`: Confirm authorized automation.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--version <value>`: Expected workspace version.

## trsd library reviews

Reviews operations.

### trsd library reviews list

List the selected resource.

Operation: read. Result schema: `treeseed.command.list/v1`.
Control-plane operation: `knowledge.reviews.list`.

- `--server <value>`: Control-plane server profile or URL.
- `--team <value>`: Team id or slug.
- `--status <value>`: Status filter.
- `--limit <value>`: Page size.
- `--cursor <value>`: Opaque page cursor.
- `--json`: Emit the stable JSON envelope.

### trsd library reviews decide <review>

Decide the selected resource.

Operation: mutation. Result schema: `treeseed.command.decide/v1`.
Control-plane operation: `knowledge.reviews.decide`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--input <value>`: YAML or JSON review decision.

### trsd library reviews publish <review>

Publish the selected resource.

Operation: mutation. Result schema: `treeseed.command.publish/v1`.
Control-plane operation: `knowledge.reviews.publish`.

- `--server <value>`: Control-plane server profile or URL.
- `--json`: Emit the stable JSON envelope.
- `--plan`: Return the exact proposed outcome without mutation.
- `--input <value>`: Optional YAML or JSON publication body.

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
