import type { TreeseedCommandHandler } from '../types.js';
import { currentManagedBranch, PRODUCTION_BRANCH, STAGING_BRANCH } from '../../../scripts/git-workflow-lib.ts';
import { guidedResult } from './utils.js';
import { handleClose } from './close.js';
import { handleDestroy } from './destroy.js';

export const handleTeardown: TreeseedCommandHandler = async (invocation, context) => {
	const commandName = invocation.commandName || 'teardown';
	const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment : null;
	if (environment) {
		return handleDestroy({
			...invocation,
			commandName,
		}, context);
	}

	const branch = currentManagedBranch(context.cwd);
	if (!branch || branch === STAGING_BRANCH || branch === PRODUCTION_BRANCH) {
		return guidedResult({
			command: commandName,
			summary: 'Treeseed teardown needs an explicit persistent environment on staging or main.',
			facts: [{ label: 'Current branch', value: branch ?? '(none)' }],
			nextSteps: [
				'treeseed teardown --environment staging',
				'treeseed teardown --environment prod',
			],
			report: {
				branch,
			},
			exitCode: 1,
		});
	}

	if (invocation.args.dryRun === true) {
		return guidedResult({
			command: commandName,
			summary: `Dry run: Treeseed would merge ${branch} into staging and remove any branch preview artifacts.`,
			facts: [{ label: 'Branch', value: branch }],
			nextSteps: ['treeseed teardown'],
			report: {
				branch,
				dryRun: true,
				mode: 'feature-close',
			},
		});
	}

	return handleClose({
		...invocation,
		commandName,
	}, context);
};
