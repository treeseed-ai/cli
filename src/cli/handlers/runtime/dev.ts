import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runManagedDev } from '@treeseed/sdk';
import { discoverApplications } from '@treeseed/sdk/hosting';
import {
	collectReconcileStatus,
	destroyTargetUnits,
	planReconciliation,
	reconcileTarget,
	type ReconcileSelector,
} from '@treeseed/sdk/reconcile';
import { compileDesiredResourceGraph, compileDesiredUnitsFromGraph } from '@treeseed/sdk/platform/desired-state';
import type { CommandHandler } from '../../types.js';
import { resolveDevProcessAction } from './dev-lifecycle.js';
import { workflowErrorResult } from '../operations/workflow.js';
import { fail } from '../utilities/utils.js';

function stringOption(args: Record<string, unknown>, name: string) {
	const value = args[name];
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberOption(args: Record<string, unknown>, name: string) {
	const value = args[name];
	const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
	return Number.isFinite(parsed) ? parsed : undefined;
}

export const handleDev: CommandHandler = async (invocation, context) => {
	try {
		if (invocation.commandName !== 'dev') {
			return fail('`trsd dev` starts the Market web/API/dev-runner runtime. Use `trsd capacity ...` for capacity provider lifecycle commands.');
		}
		const removedOptions = ['surface', 'surfaces', 'withWorker'].filter((name) => invocation.args[name] !== undefined);
		if (removedOptions.length > 0) {
			return fail(`\`trsd dev\` no longer accepts ${removedOptions.map((name) => `--${name.replace(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`)}`).join(', ')}. It always starts fixed Market web/API/dev-runner surfaces; use \`trsd capacity ...\` for providers.`);
		}

		const feedback = typeof invocation.args.feedback === 'string' ? invocation.args.feedback : undefined;
		const watch = feedback !== 'off';
		const appId = stringOption(invocation.args, 'app');
		const apiMode = stringOption(invocation.args, 'api') ?? 'auto';
		const subcommand = typeof invocation.positionals[0] === 'string' ? invocation.positionals[0] : '';
		const effectiveSubcommand = subcommand || 'start';
		const managedSubcommands = new Set(['start', 'status', 'logs', 'stop', 'restart']);
		if (subcommand && !managedSubcommands.has(subcommand)) {
			return fail(`Unknown dev subcommand "${subcommand}". Use start, status, logs, stop, or restart.`);
		}

		const discoveredApps = discoverApplications(context.cwd);
		const localContent = (stringOption(invocation.args, 'localContent') as 'auto' | 'none' | 'preview' | 'edit' | undefined) ?? 'auto';
		const target = { kind: 'persistent' as const, scope: 'local' as const };
		const desiredGraph = compileDesiredResourceGraph({
			tenantRoot: context.cwd,
			target,
			localContent,
		});
		const localProcessServiceIds = new Set(
			compileDesiredUnitsFromGraph(desiredGraph, {
				environment: 'local',
				resourceKind: ['local-process'],
			}).map((unit) => typeof unit.metadata.serviceId === 'string' ? unit.metadata.serviceId : null),
		);
		const hasLocalApi = localProcessServiceIds.has('api') || localProcessServiceIds.has('operations-runner');
		const selectedSurfaces = appId === 'api'
			? 'api'
			: appId === 'web' || apiMode === 'remote'
				? 'web'
				: hasLocalApi
					? 'web,api'
					: 'web';

		const passthroughArgs: string[] = ['--surfaces', selectedSurfaces];
		const forwardStringOption = (name: string, flag: string) => {
			const value = stringOption(invocation.args, name);
			if (value) {
				passthroughArgs.push(flag, value);
			}
		};
		const forwardBooleanOption = (name: string, flag: string) => {
			if (invocation.args[name] === true) {
				passthroughArgs.push(flag);
			}
		};

		forwardStringOption('host', '--host');
		forwardStringOption('port', '--port');
		forwardStringOption('webRuntime', '--web-runtime');
		forwardStringOption('apiHost', '--api-host');
		forwardStringOption('apiPort', '--api-port');
		forwardStringOption('setup', '--setup');
		forwardStringOption('feedback', '--feedback');
		forwardStringOption('open', '--open');
		forwardStringOption('localContent', '--local-content');
		forwardBooleanOption('plan', '--plan');
		forwardBooleanOption('reset', '--reset');
		forwardBooleanOption('force', '--force');
		forwardBooleanOption('forceConflicts', '--force-conflicts');
		forwardBooleanOption('all', '--all');
		forwardBooleanOption('follow', '--follow');
		forwardBooleanOption('json', '--json');

		if (!existsSync(resolve(context.cwd, 'packages', 'api'))) {
			return {
				exitCode: 0,
				report: {
					command: subcommand ? `dev ${effectiveSubcommand}` : 'dev',
					alias: invocation.commandName,
					ok: true,
					watch,
					execute: false,
					args: passthroughArgs,
					appId: appId ?? null,
					apiMode,
					delegatedTo: '@treeseed/core/scripts/dev-platform',
					discoveredApps: discoveredApps.map((app) => ({
						id: app.id,
						relativeRoot: app.relativeRoot,
						roles: app.roles,
					})),
					selectedSurfaces,
				},
			};
		}

		const localProcessOptions = {
			...(stringOption(invocation.args, 'host') ? { host: stringOption(invocation.args, 'host') } : {}),
			...(numberOption(invocation.args, 'port') !== undefined ? { port: numberOption(invocation.args, 'port') } : {}),
			...(stringOption(invocation.args, 'apiHost') ? { apiHost: stringOption(invocation.args, 'apiHost') } : {}),
			...(numberOption(invocation.args, 'apiPort') !== undefined ? { apiPort: numberOption(invocation.args, 'apiPort') } : {}),
			...(stringOption(invocation.args, 'webRuntime') ? { webRuntime: stringOption(invocation.args, 'webRuntime') } : {}),
			...(invocation.args.reset === true ? { reset: true } : {}),
			...(invocation.args.force === true ? { force: true } : {}),
			...(invocation.args.forceConflicts === true ? { forceConflicts: true } : {}),
			...(invocation.args.all === true ? { all: true } : {}),
			...(invocation.args.follow === true ? { follow: true } : {}),
		};
		const planOnly = invocation.args.plan === true;

		if (effectiveSubcommand === 'stop' && invocation.args.all === true && !planOnly) {
			const result = await runManagedDev({
				action: 'stop',
				cwd: context.cwd,
				surfaces: selectedSurfaces,
				...localProcessOptions,
				all: true,
				env: context.env,
			});
			return {
				exitCode: result.ok ? 0 : 1,
				report: {
					command: 'dev stop',
					ok: result.ok,
					action: result.action,
					instances: result.instances.map((instance) => ({
						id: instance.id,
						surface: instance.surface,
						pid: instance.pid,
						running: instance.running,
						logPath: instance.logPath,
					})),
				},
				message: result.ok
					? `Treeseed dev stopped ${result.instances.length} managed instance record${result.instances.length === 1 ? '' : 's'} across worktrees.`
					: 'Treeseed dev stop found managed instances that could not be stopped.',
			};
		}

		const selectedServiceIds = selectedSurfaces
			.split(',')
			.map((surface) => surface.trim())
			.filter(Boolean)
			.flatMap((surface) => (surface === 'web' ? ['market-web'] : surface === 'api' ? ['api', 'operations-runner'] : [surface]));
		const localContentUnitIds = localContent === 'preview' || localContent === 'edit'
			? desiredGraph.resources
					.filter((resource) => resource.kind === 'local-content-materialization' && resource.spec.executeRequested === true)
					.map((resource) => resource.id)
			: [];
		const includeTreeDxUnits = localContent !== 'none'
			&& selectedSurfaces.split(',').map((surface) => surface.trim()).includes('web');
		const selectedUnitIds = [
			...selectedServiceIds.map((serviceId) => `local-process:${serviceId}`),
			'local-docker-compose:api-postgres',
			'local-docker-compose:mailpit',
			...(selectedServiceIds.includes('api') ? ['local-seed-bootstrap:treeseed'] : []),
			...(includeTreeDxUnits ? [
				'local-treedx:team-primary',
				'local-docker-compose:treedx',
			] : []),
			...localContentUnitIds,
		];
		const selectedUnitIdSet = new Set(selectedUnitIds);
		const localProcessAction = resolveDevProcessAction({
			subcommand: effectiveSubcommand,
			reset: invocation.args.reset === true,
		});
		const selector: ReconcileSelector = {
			environment: 'local',
			unitId: selectedUnitIds,
		};
		const units = compileDesiredUnitsFromGraph(desiredGraph, selector)
			.map((unit) =>
				unit.unitType === 'local-process'
					? {
							...unit,
							spec: {
								...unit.spec,
								action: selectedUnitIdSet.has(unit.unitId) ? localProcessAction : 'start',
								options: {
									...(unit.spec.options as Record<string, unknown> | undefined),
									...localProcessOptions,
									...(unit.metadata.serviceId === 'operations-runner' ? { reset: false } : {}),
								},
							},
						}
					: unit.unitType === 'local-docker-compose' && invocation.args.reset === true
						? {
								...unit,
								spec: {
									...unit.spec,
									resetData: true,
								},
							}
						: unit,
			);
		const execute = !planOnly && (effectiveSubcommand === 'start' || effectiveSubcommand === 'restart' || effectiveSubcommand === 'stop');
		const stopLike = effectiveSubcommand === 'stop';
		const statusLike = effectiveSubcommand === 'status' || effectiveSubcommand === 'logs';
		const result = statusLike
			? await collectReconcileStatus({
					tenantRoot: context.cwd,
					target,
					env: context.env,
					units,
					selector,
				})
			: stopLike
				? planOnly
					? await planReconciliation({
							tenantRoot: context.cwd,
							target,
							env: context.env,
							units,
							selector,
						})
					: await destroyTargetUnits({
							tenantRoot: context.cwd,
							target,
							env: context.env,
							units,
							selector,
							write: (line) => context.write(`[dev] ${line}`, 'stderr'),
						})
				: planOnly
					? await planReconciliation({
							tenantRoot: context.cwd,
							target,
							env: context.env,
							units,
							selector,
						})
					: await reconcileTarget({
							tenantRoot: context.cwd,
							target,
							env: context.env,
							units,
							selector,
							planOnly: false,
							write: (line) => context.write(`[dev] ${line}`, 'stderr'),
						});
		const ok = 'ready' in result ? result.ready : true;
		return {
			exitCode: ok ? 0 : 1,
			report: {
				command: subcommand ? `dev ${effectiveSubcommand}` : 'dev',
				alias: invocation.commandName,
				ok,
				watch,
				execute,
				args: passthroughArgs,
				appId: appId ?? null,
				apiMode,
				discoveredApps: discoveredApps.map((app) => ({
					id: app.id,
					relativeRoot: app.relativeRoot,
					roles: app.roles,
				})),
				selectedSurfaces,
				localContent,
				...(invocation.args.plan === true || invocation.args.verbose === true ? { desiredGraph } : {}),
				reconcile: result,
			},
		};
	} catch (error) {
		return workflowErrorResult(error);
	}
};
