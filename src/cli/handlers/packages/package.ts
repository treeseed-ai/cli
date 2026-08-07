import { buildPackageArtifact, hydratePackageArtifacts, initializePackage, syncPackageWorkflows, validatePackageManifests, verifyPackageArtifact } from '@treeseed/sdk/workflow-support';
import type { CommandHandler } from '../../types.js';
import { runPackageImageCommand } from './package-image.js';
import { fail, guidedResult } from '../utilities/utils.js';

export const handlePackage: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'status';
	try {
		if (action === 'init') {
			const required = (name: string) => {
				const value = invocation.args[name];
				if (typeof value !== 'string' || !value.trim()) throw new Error(`package init requires --${name === 'defaultBranch' ? 'default-branch' : name} <value>.`);
				return value.trim();
			};
			const execute = invocation.args.yes === true;
			if (execute && invocation.args.plan === true) throw new Error('package init accepts either --plan or --yes, not both.');
			if (!execute && invocation.args.plan !== true) throw new Error('package init requires --plan for preview or --yes for live initialization.');
			const result = initializePackage({
				workspaceRoot: context.cwd, packageId: required('id'), name: required('name'), repository: required('repository'),
				path: required('path'), kind: required('kind') as 'node-typescript', type: required('type'), license: required('license') as 'Apache-2.0',
				template: required('template') as 'metadata', defaultBranch: required('defaultBranch') as 'main', execute,
			});
			return guidedResult({
				command: 'package init', summary: execute ? `Initialized ${result.packageId} at ${result.commitSha}.` : `Planned initialization of ${result.packageId}.`,
				facts: [{ label: 'Mode', value: result.mode }, { label: 'Repository', value: result.repository }, { label: 'Path', value: result.path }, { label: 'Branch', value: result.branch }, { label: 'Commit', value: result.commitSha }],
				sections: [{ title: 'Actions', lines: result.actions.map((entry) => `${entry.kind}: ${entry.target}`) }], report: { result },
			});
		}
		if (action === 'image') return runPackageImageCommand(invocation, context, { commandName: 'package image' });
		if (action === 'artifact') {
			const artifactAction = invocation.positionals[1] ?? 'build';
			if (artifactAction === 'build') {
				const result = buildPackageArtifact({
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
				const result = verifyPackageArtifact({
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
			if (artifactAction === 'hydrate') {
				const result = hydratePackageArtifacts({
					artifactsRoot: typeof invocation.args.artifactsRoot === 'string' ? invocation.args.artifactsRoot : '.treeseed/artifacts/packages',
					projectRoot: typeof invocation.args.projectRoot === 'string' ? invocation.args.projectRoot : context.cwd,
				});
				return guidedResult({
					command: 'package artifact hydrate',
					summary: `Hydrated ${result.packages.length} verified candidate package artifacts.`,
					facts: result.packages.map((pkg) => ({ label: pkg.packageName, value: `${pkg.packageVersion} (${pkg.sourceSha.slice(0, 12)})` })),
					report: result,
				});
			}
			return fail('Unknown package artifact action. Use build, verify, or hydrate.');
		}
		if (action === 'workflow') {
			const workflowAction = invocation.positionals[1] ?? 'sync';
			if (workflowAction !== 'sync') return fail('Unknown package workflow action. Use sync.');
			const results = syncPackageWorkflows({
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
			const results = validatePackageManifests(context.cwd);
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
		return fail('Unknown package action. Use init, artifact, image, workflow, or validate.');
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
};
