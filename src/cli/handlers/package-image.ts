import {
	runTreeseedPackageImageWorkflow,
} from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler, TreeseedParsedInvocation } from '../types.js';
import { fail, guidedResult } from './utils.js';

function stringArg(invocation: TreeseedParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boolArg(invocation: TreeseedParsedInvocation, key: string) {
	return invocation.args[key] === true;
}

function jsonResult(invocation: TreeseedParsedInvocation, context: unknown, report: Record<string, unknown>) {
	if ((context as { outputFormat?: string }).outputFormat === 'json' || boolArg(invocation, 'json')) {
		return { exitCode: 0, stdout: [JSON.stringify(report, null, 2)], stderr: [], report };
	}
	return null;
}

export async function runPackageImageCommand(
	invocation: TreeseedParsedInvocation,
	context: Parameters<TreeseedCommandHandler>[1],
	options: { packageId?: string | null; commandName?: string } = {},
) {
	const packageId = options.packageId ?? stringArg(invocation, 'package') ?? stringArg(invocation, 'packageId');
	if (!packageId) {
		return fail('Missing --package. Use `trsd package image --package <package-id>`.');
	}
	const branch = stringArg(invocation, 'branch') ?? 'staging';
	const workflow = stringArg(invocation, 'workflow') ?? null;
	const execute = boolArg(invocation, 'execute');
	const syncConfig = boolArg(invocation, 'syncConfig');
	const { imagePlan, selectedWorkflow, dockerHub, credential, report } = await runTreeseedPackageImageWorkflow({
		root: context.cwd,
		packageId,
		branch,
		workflow,
		execute,
		syncConfig,
		env: context.env,
	});
	const json = jsonResult(invocation, context, report);
	if (json) return json;
	return guidedResult({
		command: options.commandName ?? 'package image',
		summary: execute ? 'Package development image workflow dispatched.' : 'Package development image plan ready.',
		facts: [
			{ label: 'Package', value: `${imagePlan.package.id} (${imagePlan.package.path})` },
			{ label: 'Workflow', value: `${selectedWorkflow} @ ${imagePlan.branch}` },
			{ label: 'Image', value: imagePlan.refs.imageRef },
			{ label: 'Moving tag', value: imagePlan.refs.movingImageRef ?? 'disabled' },
			{ label: 'GitHub credential', value: credential.configured ? `${credential.envName}${credential.fallbackUsed ? ' (fallback)' : ''}` : `${credential.envName} missing` },
			{ label: 'Docker Hub config', value: dockerHub.usernameConfigured && dockerHub.tokenConfigured ? 'configured' : 'missing' },
			{ label: 'Hosting override', value: imagePlan.hosting ? `${imagePlan.hosting.overrideEnvVar}=${imagePlan.refs.imageRef}` : 'not declared' },
		],
		sections: [
			...(imagePlan.refs.roleImages
				? [{
					title: 'Role images',
					lines: imagePlan.refs.roleImages.map((entry) => [
						entry.role,
						entry.immutableRef,
						entry.movingRef ? `moving ${entry.movingRef}` : 'moving disabled',
					].join(' | ')),
				}]
				: []),
			{ title: 'Next', lines: imagePlan.hosting ? [imagePlan.hosting.command] : [] },
		],
		report,
	});
}
