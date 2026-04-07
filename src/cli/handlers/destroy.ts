import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { TreeseedCommandHandler } from '../types.js';
import { applyTreeseedEnvironmentToProcess, assertTreeseedCommandEnvironment } from '../../../scripts/config-runtime-lib.ts';
import {
	cleanupDestroyedState,
	createPersistentDeployTarget,
	destroyCloudflareResources,
	loadDeployState,
	printDestroySummary,
	validateDestroyPrerequisites,
} from '../../../scripts/deploy-lib.ts';
import type { TreeseedCommandContext } from '../types.js';
import { guidedResult } from './utils.js';

function printDangerMessage(context: TreeseedCommandContext, deployConfig: any, state: any, expectedConfirmation: string) {
	context.write('DANGER: treeseed destroy will permanently delete this site and its Cloudflare resources.', 'stderr');
	context.write(`  Site: ${deployConfig.name}`, 'stderr');
	context.write(`  Slug: ${deployConfig.slug}`, 'stderr');
	context.write(`  Worker: ${state.workerName}`, 'stderr');
	context.write(`  D1: ${state.d1Databases.SITE_DATA_DB.databaseName}`, 'stderr');
	context.write(`  KV FORM_GUARD_KV: ${state.kvNamespaces.FORM_GUARD_KV.name}`, 'stderr');
	context.write(`  KV SESSION: ${state.kvNamespaces.SESSION.name}`, 'stderr');
	context.write('  This action is irreversible.', 'stderr');
	context.write(`  To continue, type exactly: ${expectedConfirmation}`, 'stderr');
}

export const handleDestroy: TreeseedCommandHandler = async (invocation, context) => {
	const commandName = invocation.commandName || 'destroy';
	const tenantRoot = context.cwd;
	const scope = String(invocation.args.environment);
	const target = createPersistentDeployTarget(scope);
	const dryRun = invocation.args.dryRun === true;
	const force = invocation.args.force === true;
	const skipConfirmation = invocation.args.skipConfirmation === true;
	const confirm = typeof invocation.args.confirm === 'string' ? invocation.args.confirm : null;
	const removeBuildArtifacts = invocation.args.removeBuildArtifacts === true;

	applyTreeseedEnvironmentToProcess({ tenantRoot, scope });
	assertTreeseedCommandEnvironment({ tenantRoot, scope, purpose: 'destroy' });
	const deployConfig = validateDestroyPrerequisites(tenantRoot, { requireRemote: !dryRun });
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const expectedConfirmation = deployConfig.slug;

	if (!skipConfirmation) {
		printDangerMessage(context, deployConfig, state, expectedConfirmation);
		const confirmed = confirm !== null
			? confirm === expectedConfirmation
			: await (async () => {
				const rl = readline.createInterface({ input, output });
				try {
					return (await rl.question('Confirmation: ')).trim() === expectedConfirmation;
				} finally {
					rl.close();
				}
			})();

		if (!confirmed) {
			return { exitCode: 1, stderr: ['Destroy aborted: confirmation text did not match.'] };
		}
	}

	const result = destroyCloudflareResources(tenantRoot, { dryRun, force, target });
	printDestroySummary(result);

	if (dryRun) {
		return guidedResult({
			command: commandName,
			summary: `Treeseed ${commandName} dry run completed.`,
			facts: [
				{ label: 'Environment', value: scope },
				{ label: 'Remote deletion', value: 'skipped' },
			],
			nextSteps: ['treeseed status'],
			report: {
				scope,
				dryRun: true,
				force,
				removeBuildArtifacts,
			},
		});
	}

	cleanupDestroyedState(tenantRoot, { target, removeBuildArtifacts });
	return guidedResult({
		command: commandName,
		summary: `Treeseed ${commandName} completed and local deployment state was removed.`,
		facts: [
			{ label: 'Environment', value: scope },
			{ label: 'Removed build artifacts', value: removeBuildArtifacts ? 'yes' : 'no' },
		],
		nextSteps: [
			`treeseed config --environment ${scope}`,
			'treeseed status',
		],
		report: {
			scope,
			dryRun: false,
			force,
			removeBuildArtifacts,
		},
	});
};
