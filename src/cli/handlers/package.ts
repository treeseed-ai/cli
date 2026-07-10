import { buildTreeseedPackageArtifact, syncTreeseedPackageWorkflows, validateTreeseedPackageManifests, verifyTreeseedPackageArtifact } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { runPackageImageCommand } from './package-image.js';
import { fail, guidedResult } from './utils.js';

export const handlePackage: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'status';
	try {
		if (action === 'image') return runPackageImageCommand(invocation, context, { commandName: 'package image' });
		if (action === 'artifact') {
			const artifactAction = invocation.positionals[1] ?? 'build';
			if (artifactAction === 'build') {
				const result = buildTreeseedPackageArtifact({
					packageRoot: typeof invocation.args.packageRoot === 'string' ? invocation.args.packageRoot : context.cwd,
					outputDir: typeof invocation.args.output === 'string' ? invocation.args.output : '.treeseed/artifacts/package',
				});
				return guidedResult({
					command: 'package artifact build',
					summary: `Built immutable package artifact for ${result.manifest.packageName}.`,
					facts: [
						{ label: 'Source SHA', value: result.manifest.sourceSha },
						{ label: 'SHA-256', value: result.manifest.sha256 },
						{ label: 'Artifact', value: result.artifactPath },
					],
					report: result,
				});
			}
			if (artifactAction === 'verify') {
				if (typeof invocation.args.manifest !== 'string') return fail('package artifact verify requires --manifest <path>.');
				const result = verifyTreeseedPackageArtifact({
					manifestPath: invocation.args.manifest,
					artifactPath: typeof invocation.args.artifact === 'string' ? invocation.args.artifact : undefined,
				});
				return guidedResult({
					command: 'package artifact verify',
					summary: `Verified immutable package artifact for ${result.manifest.packageName}.`,
					facts: [{ label: 'SHA-256', value: result.manifest.sha256 }],
					report: result,
				});
			}
			return fail('Unknown package artifact action. Use build or verify.');
		}
		if (action === 'workflow') {
			const workflowAction = invocation.positionals[1] ?? 'sync';
			if (workflowAction !== 'sync') return fail('Unknown package workflow action. Use sync.');
			const results = syncTreeseedPackageWorkflows({
				root: context.cwd,
				packageId: typeof invocation.args.package === 'string' && invocation.args.package.trim() ? invocation.args.package.trim() : 'all',
				execute: invocation.args.execute === true,
			});
			const changed = results.filter((entry) => entry.changed);
			return guidedResult({
				command: 'package workflow sync',
				summary: invocation.args.execute === true
					? `Synced ${changed.length} package workflow${changed.length === 1 ? '' : 's'}.`
					: `Planned package workflow sync; ${changed.length} workflow${changed.length === 1 ? '' : 's'} would change.`,
				facts: [
					{ label: 'Workflows', value: results.length },
					{ label: 'Changed', value: changed.length },
					{ label: 'Execute', value: invocation.args.execute === true ? 'yes' : 'no' },
				],
				sections: [{
					title: 'Workflows',
					lines: results.map((entry) => `${entry.packageId}: ${entry.workflow} ${entry.changed ? 'drifted' : 'ok'}${entry.written ? ' written' : ''}`),
				}],
				report: { results },
				exitCode: 0,
			});
		}
		if (action === 'validate') {
			const results = validateTreeseedPackageManifests(context.cwd);
			const selected = typeof invocation.args.package === 'string' && invocation.args.package.trim()
				? results.filter((entry) => entry.packageId === invocation.args.package || entry.packageId.endsWith(`/${invocation.args.package}`))
				: results;
			const failed = selected.filter((entry) => !entry.ok);
			return guidedResult({
				command: 'package validate',
				summary: failed.length === 0
					? `Validated ${selected.length} Treeseed package manifests.`
					: `${failed.length} Treeseed package manifest${failed.length === 1 ? '' : 's'} failed validation.`,
				facts: [
					{ label: 'Packages', value: selected.length },
					{ label: 'Failed', value: failed.length },
				],
				sections: [{
					title: 'Packages',
					lines: selected.map((entry) => {
						const issues = [...entry.errors, ...entry.warnings.map((warning) => `warning: ${warning}`)];
						return `${entry.packageId}: ${entry.ok ? 'ok' : 'failed'} (${entry.path})${issues.length > 0 ? ` - ${issues.join('; ')}` : ''}`;
					}),
				}],
				report: { results: selected },
				exitCode: failed.length === 0 ? 0 : 1,
			});
		}
		return fail('Unknown package action. Use artifact, image, workflow, or validate.');
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
};
