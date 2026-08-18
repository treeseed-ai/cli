import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import {
	reconcileContentPublication,
	reconcileTarget,
	resolveGitHubCredentialForRepository,
	resolveMachineEnvironmentValues,
	runRepositoryGit,
	type ContentPublicationChannel,
} from '@treeseed/sdk';
import { formatSeedDiagnostics,loadAndCompileSeedRepositoryUnits } from '@treeseed/sdk/seeds';
import type { CommandContext,CommandResult,ParsedInvocation } from '../../types.js';
import { fail } from '../utilities/utils.js';

const credentialKeys = [
	'TREESEED_CLOUDFLARE_ACCOUNT_ID', 'TREESEED_CLOUDFLARE_API_TOKEN', 'TREESEED_CONTENT_BUCKET_NAME',
	'TREESEED_R2_ACCESS_KEY_ID', 'TREESEED_R2_SECRET_ACCESS_KEY', 'TREESEED_GITHUB_TOKEN',
];

function textArg(invocation: ParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function channelFor(value: string | null, branch: string): ContentPublicationChannel {
	const selected = value ?? (branch === 'main' ? 'production' : branch === 'staging' ? 'staging' : 'preview');
	if (selected === 'preview' || selected === 'staging' || selected === 'production') return selected;
	throw new Error('Content publication channel must be preview, staging, or production.');
}

function gitEnvironment(token: string, env: NodeJS.ProcessEnv) {
	return {
		...env,
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
		GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`,
		GIT_TERMINAL_PROMPT: '0',
	};
}

function git(root: string, args: string[], env: NodeJS.ProcessEnv, mode: 'read' | 'mutate') {
	return runRepositoryGit(args, { cwd: root, env, mode }).stdout.trim();
}

function remoteHead(root: string, repository: string, branch: string, env: NodeJS.ProcessEnv) {
	return git(root, ['ls-remote', `https://github.com/${repository}.git`, `refs/heads/${branch}`], env, 'read').split(/\s+/u)[0] || null;
}

async function withExactCheckout<T>(input: {
	repository: string; branch: string; token: string; env: NodeJS.ProcessEnv;
	operation: (root: string, commit: string, stillCurrent: () => Promise<boolean>) => Promise<T>;
}) {
	const temporary = mkdtempSync(join(tmpdir(), 'trsd-content-publication-'));
	const env = gitEnvironment(input.token, input.env);
	try {
		const expected = remoteHead(temporary, input.repository, input.branch, env);
		if (!expected) throw new Error(`Live repository ${input.repository}@${input.branch} does not exist.`);
		git(temporary, ['init', '--quiet'], env, 'mutate');
		git(temporary, ['fetch', '--quiet', '--depth=1', '--no-tags', `https://github.com/${input.repository}.git`, `refs/heads/${input.branch}`], env, 'mutate');
		git(temporary, ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], env, 'mutate');
		const observed = git(temporary, ['rev-parse', 'HEAD'], env, 'read');
		if (observed !== expected) throw new Error(`Fetched ${input.repository}@${input.branch} at ${observed}, expected live commit ${expected}.`);
		return await input.operation(temporary, expected, async () => remoteHead(temporary, input.repository, input.branch, env) === expected);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

function r2Config(values: Record<string, string | undefined>, apply: boolean) {
	const accountId = values.TREESEED_CLOUDFLARE_ACCOUNT_ID?.trim();
	const bucket = values.TREESEED_CONTENT_BUCKET_NAME?.trim();
	const apiToken = values.TREESEED_CLOUDFLARE_API_TOKEN?.trim();
	const accessKeyId = values.TREESEED_R2_ACCESS_KEY_ID?.trim();
	const secretAccessKey = values.TREESEED_R2_SECRET_ACCESS_KEY?.trim();
	if (!apply) return null;
	if (!accountId || !bucket) throw new Error('R2 content publication requires the Cloudflare account and bucket bindings.');
	if (accessKeyId && secretAccessKey) return { accountId, bucket, accessKeyId, secretAccessKey };
	if (apiToken) return { authMode: 'api-token' as const, accountId, bucket, apiToken };
	throw new Error('R2 content publication requires a Cloudflare API token or an S3 access-key pair.');
}

export async function handleSeedContentPublish(invocation: ParsedInvocation, context: CommandContext): Promise<CommandResult> {
	const seed = textArg(invocation, 'seed');
	if (!seed) return fail('Seed content publication requires --seed <name>.');
	const planOnly = invocation.args.plan === true;
	const apply = invocation.args.apply === true;
	if (planOnly === apply) return fail('Select exactly one of --plan or --apply.');
	if (apply && invocation.args.yes !== true) return fail('Live portfolio content publication requires --apply --yes after inspecting --plan.');
	const branch = textArg(invocation, 'branch') ?? 'staging';
	const channel = channelFor(textArg(invocation, 'channel'), branch);
	const scope = channel === 'production' ? 'prod' : 'staging';
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName: seed, environment: scope });
	if (!compiled.ok || !compiled.manifest) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'content publish', ok: false, diagnostics: compiled.diagnostics } };
	const projectFilter = textArg(invocation, 'project');
	const projects = new Map(compiled.manifest.resources.projects.map((project) => [project.key, project]));
	const mappings = compiled.manifest.resources.hubRepositories.flatMap((repository) => {
		const project = projects.get(repository.project);
		if (!project || repository.role !== 'content' || project.architecture.contentPublishTarget?.kind !== 'cloudflare_r2') return [];
		if (projectFilter && project.slug !== projectFilter) return [];
		return [{ project, repository: `${repository.owner}/${repository.name}`, teamId: project.team.replace(/^team:/u, '') }];
	});
	if (!mappings.length) return fail(projectFilter ? `Seed ${seed} has no publishable content project ${projectFilter}.` : `Seed ${seed} has no publishable content repositories.`);
	const machineValues = resolveMachineEnvironmentValues(context.cwd, scope, credentialKeys);
	const values = { ...machineValues, ...context.env };
	const r2 = r2Config(values, apply);
	const contentStore = await reconcileTarget({
		tenantRoot: context.cwd, target: { kind: 'persistent', scope }, env: values,
		selector: { provider: ['cloudflare'], unitType: ['content-store'] }, planOnly,
		write: (line) => context.write(`[content store] ${line}`, 'stderr'),
	});
	const receipts = [];
	for (const mapping of mappings) {
		const credential = resolveGitHubCredentialForRepository(mapping.repository, { values, env: values });
		if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${mapping.repository}.`);
		context.write(`[content publish] Fetching ${mapping.repository}@${branch}.`, 'stderr');
		const receipt = await withExactCheckout({ repository: mapping.repository, branch, token: credential.token, env: values, operation: async (root, sourceCommit, stillCurrent) => {
			const result = await reconcileContentPublication({
				projectRoot: root, contentPath: 'src/content', teamId: mapping.teamId, projectId: mapping.project.slug,
				sourceCommit, ref: branch, channel, validateOnly: planOnly, ...(r2 ? { r2 } : {}),
				verifySourceStillCurrent: stillCurrent,
			});
			if (!await stillCurrent()) throw new Error(`Live repository ${mapping.repository}@${branch} changed while its publication was being verified.`);
			return result;
		} });
		const { artifacts, ...compact } = receipt;
		receipts.push({ repository: mapping.repository, ...compact, artifactCount: artifacts.length });
	}
	if (apply) {
		const journal = resolve(context.cwd, '.treeseed', 'content-publications', seed, `${branch}.json`);
		mkdirSync(dirname(journal), { recursive: true });
		writeFileSync(journal, `${JSON.stringify({ contract: 'treeseed.content-portfolio-publication/v1', seed, branch, channel, verified: true, receipts }, null, 2)}\n`, 'utf8');
	}
	const report = {
		command: 'content publish', ok: receipts.every((receipt) => receipt.verified), mode: planOnly ? 'plan' : 'apply',
		seed, branch, channel,
		contentStore: contentStore.plans.map((entry) => ({ unitId: entry.unit.unitId, action: entry.diff.action, reasons: entry.diff.reasons })),
		receipts,
	};
	return { exitCode: report.ok ? 0 : 1, stdout: context.outputFormat === 'json' || invocation.args.json === true ? [JSON.stringify(report, null, 2)] : [`Verified ${receipts.length} live ${seed} content repositories for ${channel}.`], stderr: [], report };
}
