import {
	applyConfigValues,
	applySafeRepairs,
	collectConfigContext,
	ensureActVerificationTooling,
	ensureSecretSessionForConfig,
	findNearestRoot,
	formatDependencyFailureDetails,
	installDependencies,
} from '@treeseed/sdk/workflow-support';
import type { CommandHandler } from '../../types.js';
import { fail, guidedResult } from '../utilities/utils.js';
import { buildCliConfigPages, runCliConfigEditor } from './config-ui.js';
import { promptForNewPassphrase, promptHidden } from './secret-prompts.js';
import { summarizeCliSecretCapabilityState } from '../../configuration/secrets-escrow.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from '../operations/workflow.js';

function normalizeConfigScopes(value: unknown) {
	const requested = Array.isArray(value)
		? value.map(String)
		: typeof value === 'string'
			? [value]
			: ['all'];
	if (requested.includes('all')) {
		return ['local', 'staging', 'prod'] as Array<'local' | 'staging' | 'prod'>;
	}
	return ['local', 'staging', 'prod'].filter((scope) => requested.includes(scope)) as Array<'local' | 'staging' | 'prod'>;
}

function normalizeBootstrapSystems(system: unknown, systems: unknown) {
	const values = [
		...(Array.isArray(system) ? system.map(String) : typeof system === 'string' ? [system] : []),
		...(typeof systems === 'string' ? systems.split(',') : Array.isArray(systems) ? systems.flatMap((value) => String(value).split(',')) : []),
	]
		.map((value) => value.trim())
		.filter(Boolean);
	return values.length > 0 ? values : undefined;
}

function formatPrintEnvReports(payload: Record<string, any>) {
	const lines: string[] = [];
	const secretCapability = buildConfigSecretCapabilityReport(payload);
	for (const report of payload.reports ?? []) {
		lines.push(`Resolved environment values for ${report.scope}`);
		lines.push(payload.secretsRevealed ? 'Secrets are shown.' : 'Secret values are masked.');
		for (const entry of report.environment?.entries ?? []) {
			const hostSource = entry.sourceRequirement
				? ` requirement=${entry.sourceRequirement}${entry.sourceProvider ? ` provider=${entry.sourceProvider}` : ''}${entry.sourceHostType ? ` hostType=${entry.sourceHostType}` : ''}`
				: '';
			lines.push(`${entry.id}=${entry.displayValue} (${entry.source}${hostSource})`);
		}
		lines.push('');
		lines.push(`Provider connection checks for ${report.scope}`);
		for (const check of report.provider?.checks ?? []) {
			const status = check.ready ? 'ready' : check.skipped ? 'skipped' : 'failed';
			lines.push(`${check.provider}: ${status} - ${check.detail}`);
		}
		lines.push('');
	}
	lines.push('Secret capability boundary');
	lines.push(`Escrowed: ${secretCapability.counts.escrowed}`);
	lines.push(`GitHub-backed: ${secretCapability.counts.githubBacked}`);
	lines.push(`Host-injected: ${secretCapability.counts.hostInjected}`);
	lines.push(`Bootstrap: ${secretCapability.counts.bootstrap}`);
	lines.push(`Provider-owned: ${secretCapability.counts.providerOwned}`);
	lines.push(`Re-entry required: ${secretCapability.counts.reentryRequired}`);
	for (const warning of secretCapability.warnings) {
		lines.push(`warning: ${warning}`);
	}
	return lines.filter((line, index, all) => !(line === '' && all[index - 1] === ''));
}

function resolveMouseEnabled(value: unknown, env: NodeJS.ProcessEnv) {
	if (value === true) {
		return true;
	}
	const envValue = env.TREESEED_UI_MOUSE;
	return envValue === '1' || envValue === 'true';
}

function configReadinessLabel(readiness: Record<string, any> | undefined) {
	if (!readiness) {
		return 'pending';
	}
	if (typeof readiness.phase === 'string' && readiness.phase.length > 0) {
		return readiness.phase;
	}
	if (readiness.deployable) {
		return 'deployable';
	}
	if (readiness.provisioned) {
		return 'provisioned';
	}
	if (readiness.configured) {
		return 'config_complete';
	}
	return 'pending';
}

function describeSecretBootstrap(secretSession: Record<string, any> | undefined) {
	if (!secretSession?.status) {
		return '(unknown)';
	}
	if (secretSession.createdWrappedKey) {
		return secretSession.unlockSource === 'env' ? 'created via env passphrase' : 'created via interactive passphrase';
	}
	if (secretSession.migratedWrappedKey) {
		return secretSession.unlockSource === 'env' ? 'migrated via env passphrase' : 'migrated via interactive passphrase';
	}
	if (secretSession.unlockSource === 'existing-session') {
		return secretSession.status.unlocked ? 'already unlocked' : 'locked';
	}
	return secretSession.unlockSource === 'env' ? 'unlocked via env passphrase' : 'unlocked interactively';
}

function describeInteractiveSecretBootstrap(secretSession: Record<string, any> | undefined) {
	if (!secretSession?.status) {
		return undefined;
	}
	if (secretSession.createdWrappedKey) {
		return 'Wrapped machine key created and unlocked.';
	}
	if (secretSession.migratedWrappedKey) {
		return 'Legacy machine key wrapped and unlocked.';
	}
	if (secretSession.unlockSource === 'interactive') {
		return 'Wrapped machine key unlocked.';
	}
	if (secretSession.unlockSource === 'env') {
		return 'Wrapped machine key unlocked from TREESEED_KEY_PASSPHRASE.';
	}
	return undefined;
}

function describeSharedStorageMigrations(migrations: Array<Record<string, any>> | undefined) {
	if (!Array.isArray(migrations) || migrations.length === 0) {
		return undefined;
	}
	return migrations.map((migration) => {
		const label = typeof migration.label === 'string' && migration.label.length > 0
			? migration.label
			: migration.entryId;
		const promotedFrom = typeof migration.promotedFrom === 'string' ? migration.promotedFrom : 'staging';
		const scopes = Array.isArray(migration.consolidatedScopes) && migration.consolidatedScopes.length > 0
			? migration.consolidatedScopes.join('/')
			: promotedFrom;
		return migration.hadConflicts
			? `${label} consolidated from ${scopes} using ${promotedFrom}`
			: `${label} promoted from ${promotedFrom}`;
	}).join('; ');
}

function candidateSecretCapabilityRecords(payload: Record<string, any>) {
	const explicit = payload.secretCapability?.records ?? payload.result?.secretCapability?.records;
	if (Array.isArray(explicit)) return explicit;
	const records: Array<Record<string, any>> = [];
	const context = payload.context as Record<string, any> | undefined;
	const readinessByScope = context?.configReadinessByScope ?? {};
	for (const [scope, readiness] of Object.entries(readinessByScope as Record<string, any>)) {
		for (const provider of ['github', 'cloudflare', 'railway'] as const) {
			const configured = Boolean((readiness as Record<string, any>)?.[provider]?.configured);
			records.push({
				id: `${scope}:${provider}`,
				custodyMode: provider === 'github' ? 'github_actions_secret_enclave' : 'host_env_injection',
				hostInjected: provider !== 'github',
				githubSecretTarget: provider === 'github' && configured ? { scope: 'repository' } : null,
				status: configured ? 'active' : 'metadata_only_reentry',
				metadataOnly: !configured,
			});
		}
	}
	if (payload.secretSession?.status) {
		records.push({
			id: 'local-machine-key',
			custodyMode: 'bootstrap_service_secret',
			bootstrap: true,
			status: payload.secretSession.status.unlocked ? 'active' : 'metadata_only_reentry',
		});
	}
	return records;
}

function buildConfigSecretCapabilityReport(payload: Record<string, any>) {
	const records = candidateSecretCapabilityRecords(payload).map((record) => ({
		...record,
		summary: summarizeCliSecretCapabilityState(record),
	}));
	const counts = {
		metadataOnly: records.filter((record) => record.summary.metadataOnly).length,
		escrowed: records.filter((record) => record.summary.escrowed).length,
		githubBacked: records.filter((record) => record.summary.githubBacked).length,
		hostInjected: records.filter((record) => record.summary.hostInjected).length,
		bootstrap: records.filter((record) => record.summary.bootstrap).length,
		providerOwned: records.filter((record) => record.summary.providerOwned).length,
		migrated: records.filter((record) => record.summary.migrated).length,
		expired: records.filter((record) => record.summary.expired).length,
		tombstoned: records.filter((record) => record.summary.tombstoned).length,
		reentryRequired: records.filter((record) => record.summary.reentryRequired || record.summary.metadataOnly).length,
	};
	const warnings = [
		...records.flatMap((record) => record.summary.warnings),
		'Admin browser encryption depends on the integrity of the hosted Admin JavaScript.',
		'Secret-bearing workflows must use allowlisted GitHub Actions operations with protected refs and environments.',
	].filter((warning, index, all) => all.indexOf(warning) === index);
	return { records, counts, warnings };
}

function actionableSecretCapabilityNextSteps(warnings: string[]) {
	return warnings.filter((warning) =>
		/re-enter|fail-closed|expired|tombstoned/iu.test(warning),
	);
}

function isGenericSecretPolicyNote(step: string) {
	return /Host env injection exposes runtime secrets|Bootstrap service secrets are crown-jewel|Admin browser encryption depends|Secret-bearing workflows must use allowlisted GitHub Actions operations/iu.test(step);
}

function renderConfigResult(commandName: string, result: any) {
	const payload = result.payload as Record<string, any>;
	const toolHealth = payload.toolHealth as Record<string, any> | undefined;
	const configContext = payload.context as Record<string, any> | undefined;
	const readinessByScope = payload.result?.readinessByScope ?? {};
	const configReadinessByScope = configContext?.configReadinessByScope ?? {};
	const providerConfigStatus = (provider: 'github' | 'cloudflare' | 'railway') => {
		const selectedScopes = Array.isArray(payload.scopes) && payload.scopes.length > 0
			? payload.scopes
			: Object.keys(configReadinessByScope);
		return selectedScopes.some((scope) => configReadinessByScope?.[scope]?.[provider]?.configured)
			? 'configured'
			: 'missing';
	};
	const bootstrapSystemsByScope = payload.result?.bootstrapSystemsByScope ?? payload.bootstrapSystemsByScope ?? {};
	const skippedSystems = Object.values(bootstrapSystemsByScope as Record<string, any>)
		.flatMap((entry: any) => Array.isArray(entry?.skipped) ? entry.skipped : []);
	const resourceInventoryByScope = payload.result?.resourceInventoryByScope ?? payload.resourceInventoryByScope ?? {};
	const secretSession = payload.secretSession as Record<string, any> | undefined;
	const sharedStorageMigrations = payload.result?.sharedStorageMigrations as Array<Record<string, any>> | undefined;
	const secretCapability = buildConfigSecretCapabilityReport(payload);
	const summary = payload.mode === 'print-env-only'
		? 'Treeseed config environment report completed.'
		: payload.mode === 'rotate-machine-key'
			? 'Treeseed machine key rotated successfully.'
			: payload.mode === 'connect-market'
				? 'TreeSeed pairing completed successfully.'
				: payload.mode === 'bootstrap-preflight'
					? 'Treeseed bootstrap verification preflight completed.'
				: payload.mode === 'bootstrap'
					? 'Treeseed platform bootstrap completed successfully.'
				: 'Treeseed config completed successfully.';
	const market = payload.market as Record<string, any> | undefined;
	const nextSteps = [
		...(payload.passphraseEnv?.configured ? [] : [payload.passphraseEnv?.recommendedLaunch].filter(Boolean)),
		...actionableSecretCapabilityNextSteps(secretCapability.warnings),
		...renderWorkflowNextSteps(result),
	].filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
		.filter((step) => !isGenericSecretPolicyNote(step));
	return guidedResult({
		command: commandName,
		summary,
		facts: [
			{ label: 'Mode', value: payload.mode },
			{ label: 'Scopes', value: Array.isArray(payload.scopes) ? payload.scopes.join(', ') : '(none)' },
			{ label: 'Sync', value: payload.sync ?? 'all' },
			{ label: 'Bootstrap systems', value: Object.values(bootstrapSystemsByScope as Record<string, any>).flatMap((entry: any) => entry?.runnable ?? []).filter((value, index, all) => all.indexOf(value) === index).join(', ') || '(none)' },
			{ label: 'Skipped systems', value: skippedSystems.map((entry: any) => entry.system).filter((value, index, all) => all.indexOf(value) === index).join(', ') || '(none)' },
			{ label: 'Safe repairs', value: Array.isArray(payload.repairs) ? payload.repairs.length : 0 },
			{ label: 'Machine config', value: payload.configPath },
			{ label: 'Machine key', value: payload.keyPath },
			{ label: 'Passphrase env', value: payload.passphraseEnv?.configured ? 'configured' : 'unset' },
			{ label: 'Secrets session', value: describeSecretBootstrap(secretSession) },
			{ label: 'Shared consolidations', value: describeSharedStorageMigrations(sharedStorageMigrations) },
			{ label: 'Deployment key', value: resourceInventoryByScope.staging?.identity?.deploymentKey ?? resourceInventoryByScope.prod?.identity?.deploymentKey ?? '(unset)' },
			{ label: 'Team', value: resourceInventoryByScope.staging?.identity?.teamId ?? resourceInventoryByScope.prod?.identity?.teamId ?? '(unset)' },
			{ label: 'Project', value: resourceInventoryByScope.staging?.identity?.projectId ?? resourceInventoryByScope.prod?.identity?.projectId ?? '(unset)' },
			{ label: 'Local readiness', value: configReadinessLabel(readinessByScope.local) },
			{ label: 'Staging readiness', value: configReadinessLabel(readinessByScope.staging) },
			{ label: 'Prod readiness', value: configReadinessLabel(readinessByScope.prod) },
			{ label: 'Pages project', value: resourceInventoryByScope.staging?.resources?.pagesProject ?? resourceInventoryByScope.prod?.resources?.pagesProject ?? '(unset)' },
			{ label: 'R2 bucket', value: resourceInventoryByScope.staging?.resources?.contentBucket ?? resourceInventoryByScope.prod?.resources?.contentBucket ?? '(unset)' },
			{ label: 'GitHub token/config', value: providerConfigStatus('github') },
			{ label: 'Cloudflare token/config', value: providerConfigStatus('cloudflare') },
			{ label: 'Railway token/config', value: providerConfigStatus('railway') },
			{ label: 'Secret capability', value: `escrowed ${secretCapability.counts.escrowed}, GitHub ${secretCapability.counts.githubBacked}, host ${secretCapability.counts.hostInjected}, re-entry ${secretCapability.counts.reentryRequired}` },
			{ label: 'GitHub CLI', value: toolHealth?.githubCli?.available ? 'ready' : 'missing' },
			{ label: 'Wrangler CLI', value: toolHealth?.wranglerCli?.available ? 'ready' : 'missing' },
			{ label: 'Railway CLI', value: toolHealth?.railwayCli?.available ? 'ready' : 'missing' },
			{ label: 'gh act', value: toolHealth?.ghActExtension?.available ? 'ready' : 'missing' },
			{ label: 'Docker', value: toolHealth?.dockerDaemon?.available ? 'ready' : 'missing' },
			{ label: 'ACT verify', value: toolHealth?.actVerificationReady ? 'ready' : 'not ready' },
			...(market ? [
				{ label: 'Market base URL', value: market.baseUrl ?? '(none)' },
				{ label: 'Market team', value: market.teamSlug ?? market.teamId ?? '(none)' },
				{ label: 'Market project', value: market.projectSlug ?? market.projectId ?? '(none)' },
				{ label: 'Hub mode', value: market.hubMode ?? '(unknown)' },
				{ label: 'Runtime mode', value: market.runtimeMode ?? '(unknown)' },
				{ label: 'Runtime ready', value: market.runtimeReady ? 'yes' : 'no' },
			] : []),
		],
		nextSteps,
		report: {
			...payload,
			secretCapability,
		},
	});
}

export const handleConfig: CommandHandler = async (invocation, context) => {
	try {
		const workflow = createWorkflowSdk(context, {
			write: context.outputFormat === 'json' ? (() => {}) : context.write,
		});
		const scopes = normalizeConfigScopes(invocation.args.environment);
		const sync = invocation.args.sync as never;
		const systems = normalizeBootstrapSystems(invocation.args.system, invocation.args.systems);
		const interactive = context.outputFormat !== 'json'
			&& context.interactiveUi !== false
			&& process.stdin.isTTY
			&& process.stdout.isTTY;
		const nonInteractive = invocation.args.nonInteractive === true || context.outputFormat === 'json';
		const operationalMode = invocation.args.printEnvOnly === true || invocation.args.rotateMachineKey === true || invocation.args.connectMarket === true || invocation.args.bootstrap === true;
		if (!interactive && !nonInteractive && !operationalMode) {
			return fail('Treeseed config requires a TTY for the interactive editor. Re-run in a terminal, or use --non-interactive, --json, --bootstrap, --print-env-only, --rotate-machine-key, or --connect-market.');
		}
		if (interactive && !nonInteractive && !operationalMode) {
			const tenantRoot = findNearestRoot(context.cwd) ?? context.cwd;
			if (!tenantRoot) {
				return fail('Treeseed config requires a Treeseed project. Run the command from inside a tenant or initialize one first.');
			}
			const dependencyInstall = await installDependencies({
				tenantRoot,
				force: invocation.args.installMissingTooling === true,
				env: context.env,
				write: context.write,
			});
			if (!dependencyInstall.ok) {
				return fail(`Treeseed dependency initialization failed:\n- ${formatDependencyFailureDetails(dependencyInstall)}`);
			}
			applySafeRepairs(tenantRoot);
			const toolAvailability = ensureActVerificationTooling({
				tenantRoot,
				installIfMissing: invocation.args.installMissingTooling === true,
				env: context.env,
				write: context.write,
			});
			const secretSession = await ensureSecretSessionForConfig({
				tenantRoot,
				interactive: true,
				env: context.env,
				promptForPassphrase: () => promptHidden('Treeseed passphrase: '),
				promptForNewPassphrase,
			});
			const configContext = collectConfigContext({
				tenantRoot,
				scopes,
				env: context.env,
			});
			const initialViewMode = (() => {
				if (invocation.args.full === true) {
					return 'full' as const;
				}
				return buildCliConfigPages(configContext, 'local', {}, 'startup').length > 0
					? 'startup' as const
					: 'full' as const;
			})();
			const editorResult = await runCliConfigEditor(configContext, {
				initialViewMode,
				mouseEnabled: resolveMouseEnabled(invocation.args.mouse, context.env),
				initialStatusMessage: describeInteractiveSecretBootstrap(secretSession),
				toolAvailability,
				secretSession,
				onCommit: async (update) => {
					applyConfigValues({
						tenantRoot,
						updates: [{
							scope: update.scope,
							entryId: update.entryId,
							value: update.value,
							reused: false,
						}],
					});
					return collectConfigContext({
						tenantRoot,
						scopes,
						env: context.env,
					});
				},
			});
			if (editorResult === null) {
				return fail('Treeseed config canceled.');
			}
			const refreshedContext = collectConfigContext({
				tenantRoot,
				scopes,
				env: context.env,
			});
			const updates = refreshedContext.scopes
				.flatMap((scope) => buildCliConfigPages(refreshedContext, scope, editorResult.overrides, 'full'))
				.filter((page, index, allPages) => allPages.findIndex((candidate) => candidate.key === page.key) === index)
				.map((page) => ({
				scope: page.scope,
				entryId: page.entry.id,
				value: page.finalValue,
				reused: !(page.key in editorResult.overrides),
			}));
			const effectiveSync = sync ?? 'all';
			context.write(
				effectiveSync !== 'none'
					? 'Applying config updates, validating environments, and syncing selected managed providers...'
					: 'Applying config updates and validating environments...',
				'stdout',
			);
			const result = await workflow.config({
				environment: scopes as never,
				systems: systems as never,
				skipUnavailable: invocation.args.skipUnavailable === true ? true : undefined,
				bootstrapExecution: invocation.args.bootstrapSequential === true ? 'sequential' : 'parallel',
				sync,
				printEnv: invocation.args.printEnv === true,
				showSecrets: invocation.args.showSecrets === true,
				installMissingTooling: invocation.args.installMissingTooling === true,
				nonInteractive: true,
				updates,
			});
			return renderConfigResult(invocation.commandName || 'config', result);
		}

		const result = await workflow.config({
			environment: invocation.args.environment as never,
			systems: systems as never,
			skipUnavailable: invocation.args.skipUnavailable === true ? true : undefined,
			bootstrapExecution: invocation.args.bootstrapSequential === true ? 'sequential' : 'parallel',
			sync,
			bootstrap: invocation.args.bootstrap === true,
			preflight: invocation.args.preflight === true,
			printEnv: invocation.args.printEnv === true,
			printEnvOnly: invocation.args.printEnvOnly === true,
			showSecrets: invocation.args.showSecrets === true,
			rotateMachineKey: invocation.args.rotateMachineKey === true,
			connectMarket: invocation.args.connectMarket === true,
			marketBaseUrl: typeof invocation.args.marketBaseUrl === 'string' ? invocation.args.marketBaseUrl : undefined,
			marketTeamId: typeof invocation.args.marketTeamId === 'string' ? invocation.args.marketTeamId : undefined,
			marketTeamSlug: typeof invocation.args.marketTeamSlug === 'string' ? invocation.args.marketTeamSlug : undefined,
			marketProjectId: typeof invocation.args.marketProjectId === 'string' ? invocation.args.marketProjectId : undefined,
			marketProjectSlug: typeof invocation.args.marketProjectSlug === 'string' ? invocation.args.marketProjectSlug : undefined,
			marketProjectApiBaseUrl: typeof invocation.args.marketProjectApiBaseUrl === 'string' ? invocation.args.marketProjectApiBaseUrl : undefined,
			marketAccessToken: typeof invocation.args.marketAccessToken === 'string' ? invocation.args.marketAccessToken : undefined,
			rotateRunnerToken: invocation.args.rotateRunnerToken === true,
			installMissingTooling: invocation.args.installMissingTooling === true,
			nonInteractive,
		});
		if (context.outputFormat !== 'json' && (result.payload as Record<string, any>).mode === 'print-env-only') {
			return {
				exitCode: 0,
				stdout: formatPrintEnvReports(result.payload as Record<string, any>),
				report: {
					command: invocation.commandName || 'config',
					ok: true,
					...(result.payload as Record<string, any>),
				},
			};
		}
		return renderConfigResult(invocation.commandName || 'config', result);
	} catch (error) {
		return workflowErrorResult(error);
	}
};
