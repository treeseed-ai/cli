import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from './operations-registry-support.ts';

export const stagingAndReleaseCommandOverlays: Array<[string, CommandOverlay]> = [
	['ci', command({
			options: [
				{ name: 'failed', flags: '--failed', description: 'Focus human output on failures and attention-needed workflows.', kind: 'boolean' },
				{ name: 'logs', flags: '--logs', description: 'Fetch capped log excerpts for failed jobs.', kind: 'boolean' },
				{ name: 'logLines', flags: '--log-lines <n>', description: 'Maximum failed-job log lines to include with --logs.', kind: 'string' },
				{ name: 'scope', flags: '--scope <scope>', description: 'Select workspace, root, or package repositories.', kind: 'enum', values: ['workspace', 'root', 'packages'] },
				{ name: 'workflow', flags: '--workflow <file>', description: 'Inspect a specific workflow file. May be repeated.', kind: 'string', repeatable: true },
				{ name: 'branch', flags: '--branch <name>', description: 'Inspect this branch name in all selected repositories.', kind: 'string' },
				{ name: 'strict', flags: '--strict', description: 'Return nonzero for pending workflows as well as failures.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: ['treeseed ci', 'treeseed ci --failed', 'treeseed ci --logs --log-lines 50', 'treeseed ci --scope packages --workflow verify.yml --json'],
			help: {
				workflowPosition: 'inspect',
				longSummary: [
					'CI inspects the remote GitHub Actions runs for the current branch heads in market and checked-out package repositories.',
					'It is read-only and is designed for quickly finding failed hosted verification without digging through GitHub UI pages.',
				],
				whenToUse: [
					'Use this after `save`, `stage`, or a pushed package change when you need the latest remote verification state.',
					'Use `--failed` when you only want attention items, or `--logs` when you want failed-job excerpts inline.',
				],
				beforeYouRun: [
					'Run from the Treeseed workspace you want to inspect.',
					'Make sure the branch heads you care about have been pushed; unpushed heads are reported as not pushed.',
					'Use `--json` for agent or script consumption.',
				],
				outcomes: [
					'Lists passing, pending, missing, not-pushed, and failing GitHub Actions workflows.',
					'Shows failed jobs, failed steps when GitHub provides them, workflow URLs, and inspect commands.',
				],
				examples: [
					example('treeseed ci', 'Inspect workspace CI', 'Check market and checked-out package workflows for the active branch heads.'),
					example('treeseed ci --failed', 'Focus on failures', 'Show only failed and attention-needed workflows in human output.'),
					example('treeseed ci --logs --log-lines 50', 'Include failed logs', 'Fetch compact failed-job log excerpts while keeping output bounded.'),
					example('treeseed ci --scope packages --json', 'Automate package CI checks', 'Emit structured package workflow status for agents and scripts.'),
				],
				automationNotes: [
					'`--json` includes the full repository list plus a flattened `failures` array.',
					'The command is read-only; it does not wait, rerun, or mutate GitHub Actions runs.',
				],
				relatedDetails: [
					related('status', 'Use `status` for local workspace health before inspecting hosted CI.'),
					related('save', 'Use `save` before CI inspection when local changes need to be pushed.'),
					related('stage', 'Use `stage` after hosted CI is healthy and the task is ready for staging.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'ci',
		})],
	['stage', command({
			arguments: [{ name: 'message', description: 'Resolution message for the staged task.', required: true, kind: 'message_tail' }],
			options: [
				{ name: 'plan', flags: '--plan', description: 'Compute the recursive staging plan without mutating any repo.', kind: 'boolean' },
				{ name: 'verify', flags: '--verify <mode>', description: 'Choose local proof before staging is mutated.', kind: 'enum', values: ['action', 'local', 'none'] },
				{ name: 'ciMode', flags: '--ci <mode>', description: 'Control hosted GitHub Actions waits after staging refs are promoted.', kind: 'enum', values: ['hosted', 'off'] },
				{ name: 'async', flags: '--async', description: 'Return after exact refs are promoted instead of monitoring staging CI.', kind: 'boolean' },
				{ name: 'cleanup', flags: '--cleanup <mode>', description: 'Choose source branch/worktree cleanup after successful promotion.', kind: 'enum', values: ['success', 'manual'] },
				{ name: 'updateFrom', flags: '--update-from <branch>', description: 'Branch to merge down into the feature branch before promotion. Defaults to staging.', kind: 'string' },
				{ name: 'releaseCandidate', flags: '--release-candidate <mode>', description: 'Deprecated for stage; use release-candidate directly for explicit rehearsal.', kind: 'enum', values: ['hybrid', 'strict', 'skip'] },
				{ name: 'verifyDeployedResources', flags: '--verify-deployed-resources', description: 'Deprecated for stage; use hosting verification or the staging release agent after promotion.', kind: 'boolean' },
				{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: ['treeseed stage "feat: add search filters"', 'treeseed stage --plan "feat: add search filters"', 'treeseed stage --verify none --cleanup manual "handoff to staging agent"'],
			notes: ['Stage merges staging down into the feature branch before staging is mutated.', 'Stage performs local branch promotion by default; use --ci hosted only when hosted verification is intentionally required.', 'After staging refs are verified, stage deletes the exact merged source branches by default; use --cleanup manual only when they must be preserved intentionally.'],
			help: {
				workflowPosition: 'merge to staging',
				longSummary: [
					'Stage is the task completion command for the normal promotion path. It first merges staging down into the current feature branch, runs local proof, then promotes exact verified refs to staging.',
					'Hosted workflow monitoring is opt-in with --ci hosted; normal stage promotion does not deploy provider infrastructure.',
				],
				whenToUse: [
					'Use this when a task branch is ready for the staging environment.',
					'Use it instead of manual merge steps when you want the standard Treeseed task promotion workflow with conflict handling before staging is changed.',
				],
				outcomes: [
					'Merges staging into the feature branch first.',
					'Runs local proof before staging mutation by default.',
					'Promotes exact verified package and root SHAs to staging.',
					'Deletes exact merged source branches and cleans managed worktrees after staging refs are verified.',
				],
				examples: [
					example('treeseed stage "feat: add search filters"', 'Promote a completed task', 'Merge the current task branch into staging with a resolution message.'),
					example('treeseed stage --verify local "feat: package topology"', 'Stage with local proof', 'Use local package verification instead of gh act action-parity checks.'),
					example('treeseed stage --verify none --cleanup manual "handoff"', 'Merge-only handoff', 'Promote clean coherent refs and preserve source branches for a staging release agent.'),
					example('treeseed stage "fix: stabilize staging deploy"', 'Stage a fix branch', 'Advance a staging-targeted fix into the shared staging branch.'),
					example('treeseed stage --json "feat: add search filters"', 'Automate staging promotion', 'Emit structured workflow output during task promotion.'),
				],
				relatedDetails: [
					related('save', 'Use `save` while the task is still in progress.'),
					related('release', 'Use `release` after staging is in the state you want to promote to production.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'stage',
		})],
	['release-candidate', command({
			usage: 'treeseed release-candidate [--strict] [--verify-driver auto|local|action] [--package <id>]... [--json]',
			options: [
				{ name: 'mode', flags: '--mode <mode>', description: 'Release-candidate mode to run.', kind: 'enum', values: ['hybrid', 'strict', 'skip'] },
				{ name: 'strict', flags: '--strict', description: 'Require authoritative hosted proof for release-candidate subjects.', kind: 'boolean' },
				{ name: 'verifyDriver', flags: '--verify-driver <driver>', description: 'Choose proof driver. auto uses hosted proof for strict mode; action is advisory.', kind: 'enum', values: ['auto', 'local', 'action'] },
				{ name: 'skipAction', flags: '--skip-action', description: 'Use local proof commands instead of advisory action simulation.', kind: 'boolean' },
				{ name: 'package', flags: '--package <id>', description: 'Limit proof to one package id or name. Repeatable.', kind: 'string', multiple: true },
				{ name: 'keepWorkspace', flags: '--keep-workspace', description: 'Accepted for compatibility; proof-ledger runs do not create a rehearsal workspace.', kind: 'boolean' },
				{ name: 'plan', flags: '--plan', description: 'Show the proof plan without running missing nodes.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: [
				'treeseed release-candidate --strict --json',
				'treeseed release-candidate --verify-driver local --json',
				'treeseed release-candidate --verify-driver action --package @treeseed/sdk --json',
			],
			help: {
				workflowPosition: 'release proof',
				longSummary: [
					'Release-candidate plans and runs reusable proof-ledger nodes for exact package refs.',
					'Strict release-candidate proof uses hosted GitHub workflow results as the authoritative CI/CD verdict.',
				],
				whenToUse: [
					'Use this before stage when package dependencies, manifests, TreeDX, workflow files, or publish packaging changed.',
					'Use this before production release, or let release run a fresh strict proof when no valid proof exists.',
					'Use --verify-driver action only as advisory workflow simulation; it cannot satisfy hosted release proof.',
				],
				outcomes: [
					'Reuses passed proof records when package refs and proof inputs are unchanged.',
					'Runs only missing or invalid proof subjects.',
					'Reports the exact failed proof subject and hosted workflow run when proof fails.',
				],
			},
			executionMode: 'handler',
			handlerName: 'release-candidate',
		})],
	['proof', command({
			usage: 'treeseed proof <plan|run|status|failures|explain|clean> [--target <environment>] [--driver <driver>] [--subject <id>] [--json]',
			arguments: [{ name: 'action', description: 'Proof action to run.', required: false }],
			options: [
				{ name: 'target', flags: '--target <environment>', description: 'Select proof target environment.', kind: 'enum', values: ['local', 'staging', 'prod'] },
				{ name: 'driver', flags: '--driver <driver>', description: 'Select proof driver. github-hosted is authoritative; act is advisory.', kind: 'enum', values: ['github-hosted', 'act', 'local', 'railway-live', 'cloudflare-live', 'reconcile-live'] },
				{ name: 'subject', flags: '--subject <id>', description: 'Limit proof to one subject, such as package:treedx.', kind: 'string' },
				{ name: 'last', flags: '--last', description: 'Explain the most recent proof record.', kind: 'boolean' },
				{ name: 'olderThan', flags: '--older-than <duration>', description: 'Clean proof records older than a duration like 30d or 12h.', kind: 'string' },
				{ name: 'plan', flags: '--plan', description: 'Plan proof work without writing records.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON.', kind: 'boolean' },
			],
			examples: [
				'treeseed proof plan --target staging --json',
				'treeseed proof run --target staging --json',
				'treeseed proof run --subject package:treedx --driver github-hosted --json',
				'treeseed proof failures --json',
				'treeseed proof explain --last --json',
			],
			help: {
				workflowPosition: 'release proof',
				longSummary: [
					'Proof manages reusable release proof records for exact package refs, hosted GitHub workflows, and future provider live checks.',
					'GitHub-hosted workflow proof is authoritative for CI/CD. Local `act` proof is advisory and cannot satisfy promotion proof.',
				],
				whenToUse: [
					'Use `proof plan` before a promotion save to see which exact-SHA proof records are missing.',
					'Use `proof run` to observe or create authoritative hosted proof records.',
					'Use `proof failures` and `proof explain` after a slow or failed promotion run.',
				],
				outcomes: [
					'Reads or writes `.treeseed/workflow/proofs` records keyed by subject, driver, and input hash.',
					'Reports reusable proof records separately from missing or failed proof records.',
				],
			},
			executionMode: 'handler',
			handlerName: 'proof',
		})],
	['release', command({
			usage: 'treeseed release --major|--minor|--patch|--repair-version-line',
			options: [
				{ name: 'major', flags: '--major', description: 'Bump to the next major version.', kind: 'boolean' },
				{ name: 'minor', flags: '--minor', description: 'Bump to the next minor version.', kind: 'boolean' },
				{ name: 'patch', flags: '--patch', description: 'Bump to the next patch version.', kind: 'boolean' },
				{ name: 'repairVersionLine', flags: '--repair-version-line', description: 'Repair public package major.minor drift without enforcing patch parity.', kind: 'boolean' },
				{ name: 'targetVersionLine', flags: '--target-version-line <major.minor>', description: 'Target release line for --repair-version-line, for example 0.10.', kind: 'string' },
				{ name: 'ciMode', flags: '--ci <mode>', description: 'Control hosted GitHub Actions waits.', kind: 'enum', values: ['auto', 'hosted', 'off'] },
				{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
				{ name: 'verifyDeployedResources', flags: '--verify-deployed-resources', description: 'Force production deployment checks to verify provider resources before release returns.', kind: 'boolean' },
				{ name: 'fresh', flags: '--fresh', description: 'Start a new release instead of auto-resuming stale failed release runs.', kind: 'boolean' },
				{ name: 'sceneArtifacts', flags: '--scene-artifacts <mode>', description: 'Choose scene evidence mode for release guarantees.', kind: 'enum', values: ['full', 'screenshots'] },
				{ name: 'noSceneVideo', flags: '--no-scene-video', description: 'Alias for --scene-artifacts screenshots.', kind: 'boolean' },
				{ name: 'plan', flags: '--plan', description: 'Compute the recursive release plan without mutating any repo.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: ['treeseed release --patch', 'treeseed release --minor --verify-deployed-resources', 'treeseed release --repair-version-line --target-version-line 0.10 --plan', 'treeseed release --patch --fresh'],
			notes: ['Requires exactly one bump flag unless --repair-version-line is used.'],
			help: {
				workflowPosition: 'promote to production',
				longSummary: [
					'Release promotes the staging state to production while applying a version bump. It is the forward promotion command once staging reflects the exact state you intend to publish.',
				],
				whenToUse: [
					'Use this only when staging is the approved source for production promotion.',
					'Choose exactly one bump flag so the release version reflects the intended change size, or use --repair-version-line to repair package line drift.',
					'Use `--verify-deployed-resources` when production provider resources must be checked before the release returns.',
				],
				beforeYouRun: [
					'Confirm staging is in the state you want to promote.',
					'Run `treeseed release-candidate --strict` first if you want to inspect the full proof before release; release will require strict proof for the exact staging state.',
					'Choose one of `--major`, `--minor`, `--patch`, or `--repair-version-line` before running the command.',
				],
				outcomes: [
					'Promotes the release forward and records the version bump.',
					'Returns release metadata in JSON mode when requested.',
				],
				examples: [
					example('treeseed release --patch', 'Patch release', 'Promote staging to production with the next patch version.'),
					example('treeseed release --minor --verify-deployed-resources', 'Minor release with hosted checks', 'Promote staging with the next minor version bump and verify production provider resources.'),
					example('treeseed release --repair-version-line --target-version-line 0.10 --json', 'Repair package line drift', 'Publish only packages below the selected public package release line.'),
					example('treeseed release --patch --json', 'Automate release tracking', 'Emit structured release output for tooling that records deployments and version changes.'),
				],
				warnings: [
					'Exactly one bump flag is required unless --repair-version-line is used.',
					'This is a production-facing promotion command, not a dry local build operation.',
				],
				relatedDetails: [
					related('stage', 'Use `stage` first to move completed task work into staging before releasing.'),
					related('rollback', 'Use `rollback` when a staging or production deployment must be restored to an earlier state.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'release',
		})],
];
