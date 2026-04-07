import type { TreeseedCommandHandler } from '../types.js';
import { handleConfig } from './config.js';
import { handleDoctor } from './doctor.js';
import { guidedResult } from './utils.js';
import { applyTreeseedSafeRepairs } from '../repair.js';
import { resolveTreeseedWorkflowState } from '../workflow-state.js';

export const handleSetup: TreeseedCommandHandler = async (invocation, context) => {
	const tenantRoot = context.cwd;
	const scopes = Array.isArray(invocation.args.environment)
		? invocation.args.environment
		: invocation.args.environment
			? [invocation.args.environment]
			: ['local'];

	const repairs = resolveTreeseedWorkflowState(tenantRoot).deployConfigPresent ? applyTreeseedSafeRepairs(tenantRoot) : [];
	const configResult = await handleConfig({
		...invocation,
		commandName: 'config',
		args: {
			...invocation.args,
			environment: scopes,
			sync: invocation.args.sync ?? 'none',
		},
		positionals: [],
		rawArgs: [
			...scopes.flatMap((scope) => ['--environment', scope]),
			...(invocation.args.json === true ? ['--json'] : []),
		],
	}, context);
	if ((configResult.exitCode ?? 0) !== 0) {
		return configResult;
	}

	const doctorResult = handleDoctor({ ...invocation, args: { ...invocation.args } }, context);
	const doctorPayload = doctorResult.report ?? {};
	return guidedResult({
		command: 'setup',
		summary: 'Treeseed setup completed.',
		facts: [
			{ label: 'Initialized environments', value: scopes.join(', ') },
			{ label: 'Safe repairs', value: repairs.length },
			{ label: 'Blocking issues remaining', value: Array.isArray((doctorPayload as { mustFixNow?: unknown[] }).mustFixNow) ? ((doctorPayload as { mustFixNow?: unknown[] }).mustFixNow?.length ?? 0) : 0 },
		],
		nextSteps: ['treeseed dev', 'treeseed work feature/my-change'],
		report: {
			repairs,
			scopes,
			config: configResult.report,
			doctor: doctorPayload,
		},
	});
};
