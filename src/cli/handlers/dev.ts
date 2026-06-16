import { discoverTreeseedApplications } from '@treeseed/sdk/hosting';
import {
	collectTreeseedReconcileStatus,
	destroyTreeseedTargetUnits,
	planTreeseedReconciliation,
	reconcileTreeseedTarget,
	type TreeseedReconcileSelector,
} from '@treeseed/sdk/reconcile';
import { compileTreeseedDesiredResourceGraph, compileTreeseedDesiredUnitsFromGraph } from '@treeseed/sdk/platform/desired-state';
import type { TreeseedCommandHandler } from '../types.js';
import { workflowErrorResult } from './workflow.js';
import { fail } from './utils.js';

export const handleDev: TreeseedCommandHandler = async (invocation, context) => {
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
		const appId = typeof invocation.args.app === 'string' && invocation.args.app.trim()
			? invocation.args.app.trim()
			: undefined;
		const apiMode = typeof invocation.args.api === 'string' && invocation.args.api.trim()
			? invocation.args.api.trim()
			: 'auto';
		const target = { kind: 'persistent' as const, scope: 'local' as const };
		const desiredGraph = compileTreeseedDesiredResourceGraph({ tenantRoot: context.cwd, target });
		const localProcessServiceIds = new Set(
			compileTreeseedDesiredUnitsFromGraph(desiredGraph, {
				environment: 'local',
				resourceKind: ['local-process'],
			}).map((unit) => typeof unit.metadata.serviceId === 'string' ? unit.metadata.serviceId : null),
		);
		const subcommand = typeof invocation.positionals[0] === 'string' ? invocation.positionals[0] : '';
		const effectiveSubcommand = subcommand || 'start';
		const managedSubcommands = new Set(['start', 'status', 'logs', 'stop', 'restart']);
		if (subcommand && !managedSubcommands.has(subcommand)) {
			return fail(`Unknown dev subcommand "${subcommand}". Use start, status, logs, stop, or restart.`);
		}
		const discoveredApps = discoverTreeseedApplications(context.cwd);
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
			const value = invocation.args[name];
			if (typeof value === 'string' && value.trim().length > 0) {
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
		forwardBooleanOption('plan', '--plan');
		forwardBooleanOption('reset', '--reset');
		forwardBooleanOption('force', '--force');
		forwardBooleanOption('forceConflicts', '--force-conflicts');
		forwardBooleanOption('all', '--all');
		forwardBooleanOption('follow', '--follow');
		forwardBooleanOption('json', '--json');
		const numberOption = (name: string) => {
			const value = invocation.args[name];
			const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
			return Number.isFinite(parsed) ? parsed : undefined;
		};
		const stringOption = (name: string) => {
			const value = invocation.args[name];
			return typeof value === 'string' && value.trim() ? value.trim() : undefined;
		};
		const localProcessOptions = {
			...(stringOption('host') ? { host: stringOption('host') } : {}),
			...(numberOption('port') !== undefined ? { port: numberOption('port') } : {}),
			...(stringOption('apiHost') ? { apiHost: stringOption('apiHost') } : {}),
			...(numberOption('apiPort') !== undefined ? { apiPort: numberOption('apiPort') } : {}),
			...(stringOption('webRuntime') ? { webRuntime: stringOption('webRuntime') } : {}),
			...(invocation.args.reset === true ? { reset: true } : {}),
			...(invocation.args.force === true ? { force: true } : {}),
			...(invocation.args.forceConflicts === true ? { forceConflicts: true } : {}),
			...(invocation.args.all === true ? { all: true } : {}),
			...(invocation.args.follow === true ? { follow: true } : {}),
		};
		const selectedServiceIds = selectedSurfaces.split(',').map((surface) => surface.trim()).filter(Boolean)
			.flatMap((surface) => surface === 'web' ? ['market-web'] : surface === 'api' ? ['api', 'operations-runner'] : [surface]);
		const selector: TreeseedReconcileSelector = {
			environment: 'local',
			resourceKind: ['local-process'],
			serviceId: selectedServiceIds,
		};
		const units = compileTreeseedDesiredUnitsFromGraph(desiredGraph, selector).map((unit) =>
			unit.unitType === 'local-process'
				? {
					...unit,
					spec: {
						...unit.spec,
						action: effectiveSubcommand === 'restart' ? 'restart' : 'start',
						options: {
							...(unit.spec.options as Record<string, unknown> | undefined),
							...localProcessOptions,
							...(unit.metadata.serviceId === 'operations-runner' ? { reset: false } : {}),
						},
					},
				}
				: unit);
		const planOnly = invocation.args.plan === true;
		const execute = !planOnly && (effectiveSubcommand === 'start' || effectiveSubcommand === 'restart' || effectiveSubcommand === 'stop');
		const stopLike = effectiveSubcommand === 'stop';
		const statusLike = effectiveSubcommand === 'status' || effectiveSubcommand === 'logs';
		const result = statusLike
			? await collectTreeseedReconcileStatus({ tenantRoot: context.cwd, target, env: context.env, units, selector })
			: stopLike
					? planOnly
						? await planTreeseedReconciliation({ tenantRoot: context.cwd, target, env: context.env, units, selector })
						: await destroyTreeseedTargetUnits({ tenantRoot: context.cwd, target, env: context.env, units, selector, write: (line) => context.write(`[dev] ${line}`, 'stderr') })
					: planOnly
						? await planTreeseedReconciliation({ tenantRoot: context.cwd, target, env: context.env, units, selector })
						: await reconcileTreeseedTarget({
							tenantRoot: context.cwd,
							target,
							env: context.env,
							units,
							selector,
							dryRun: false,
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
					...(invocation.args.plan === true || invocation.args.verbose === true ? { desiredGraph } : {}),
					reconcile: result,
				},
			};
	} catch (error) {
		return workflowErrorResult(error);
	}
};
