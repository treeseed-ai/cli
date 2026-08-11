import { resolve } from 'node:path';
import {
	reconcileContentPublication,
	reconcileTarget,
	resolveMachineEnvironmentValues,
	resolveRepositoryIdentity,
	runRepositoryGit,
	type ContentPublicationChannel,
} from '@treeseed/sdk';
import type { CommandContext,CommandResult,ParsedInvocation } from '../../types.js';
import { fail } from '../utilities/utils.js';
import { handleSeedContentPublish } from './seed-publish.js';

const credentialKeys = [
	'TREESEED_CLOUDFLARE_ACCOUNT_ID',
	'TREESEED_CLOUDFLARE_API_TOKEN',
	'TREESEED_CONTENT_BUCKET_NAME',
	'TREESEED_R2_ACCESS_KEY_ID',
	'TREESEED_R2_SECRET_ACCESS_KEY',
];

function textArg(invocation: ParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readGit(root: string, args: string[], env: CommandContext['env']) {
	return runRepositoryGit(args, { cwd: root, mode: 'read', env }).stdout.trim();
}

function publicationChannel(value: string | null, branch: string): ContentPublicationChannel {
	const selected = value ?? (branch === 'main' ? 'production' : branch === 'staging' ? 'staging' : 'preview');
	if (selected === 'preview' || selected === 'staging' || selected === 'production') return selected;
	throw new Error('Content publication channel must be preview, staging, or production.');
}

export async function handleContentPublish(invocation: ParsedInvocation, context: CommandContext): Promise<CommandResult> {
	if (textArg(invocation, 'seed')) return handleSeedContentPublish(invocation, context);
	const projectId = textArg(invocation, 'project');
	const teamId = textArg(invocation, 'team');
	if (!projectId || !teamId) return fail('Content publish requires --team <team-id> and --project <project-id>.');
	const planOnly = invocation.args.plan === true;
	const apply = invocation.args.apply === true;
	if (planOnly === apply) return fail('Select exactly one of --plan or --apply.');
	if (apply && invocation.args.yes !== true) return fail('Live content publication requires --apply --yes after inspecting --plan.');
	const requestedRoot = resolve(context.cwd, textArg(invocation, 'path') ?? '.');
	const repositoryRoot = readGit(requestedRoot, ['rev-parse', '--show-toplevel'], context.env);
	const remote = readGit(repositoryRoot, ['remote', 'get-url', 'origin'], context.env);
	const identity = resolveRepositoryIdentity(remote);
	if (!identity.repository.endsWith('-content')) return fail('Content publication must run from a paired *-content repository checkout.');
	const sourceCommit = readGit(repositoryRoot, ['rev-parse', 'HEAD'], context.env);
	const currentBranch = readGit(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], context.env);
	const ref = textArg(invocation, 'branch') ?? (currentBranch === 'HEAD' ? null : currentBranch);
	if (!ref) return fail('A detached content checkout requires --branch <exact-ref-name>.');
	const channel = publicationChannel(textArg(invocation, 'channel'), ref);
	const scope = channel === 'production' ? 'prod' : 'staging';
	const machineValues = resolveMachineEnvironmentValues(context.cwd, scope, credentialKeys);
	const value = (key: string) => context.env[key]?.trim() || machineValues[key]?.trim() || null;
	const accountId = value('TREESEED_CLOUDFLARE_ACCOUNT_ID');
	const bucket = value('TREESEED_CONTENT_BUCKET_NAME');
	const apiToken = value('TREESEED_CLOUDFLARE_API_TOKEN');
	const accessKeyId = value('TREESEED_R2_ACCESS_KEY_ID');
	const secretAccessKey = value('TREESEED_R2_SECRET_ACCESS_KEY');
	const r2 = !apply || !accountId || !bucket ? null
		: accessKeyId && secretAccessKey ? { accountId, bucket, accessKeyId, secretAccessKey }
			: apiToken ? { authMode: 'api-token' as const, accountId, bucket, apiToken } : null;
	if (apply && !r2) return fail(`R2 publication credentials are incomplete for ${scope}; configure an API token or an S3 access-key pair.`);
	const reconcileEnv = { ...context.env, ...machineValues };
	const contentStore = await reconcileTarget({
		tenantRoot: context.cwd,
		target: { kind: 'persistent', scope },
		env: reconcileEnv,
		selector: { provider: ['cloudflare'], unitType: ['content-store'] },
		planOnly,
		write: (line) => context.write(`[content store] ${line}`, 'stderr'),
	});
	const receipt = await reconcileContentPublication({
		projectRoot: repositoryRoot, contentPath: 'src/content', teamId, projectId, sourceCommit, ref, channel,
		validateOnly: planOnly,
		...(r2 ? { r2 } : {}),
	});
	const contentStorePlan = contentStore.plans.map((entry) => ({
		unitId: entry.unit.unitId,
		action: entry.diff.action,
		reasons: entry.diff.reasons,
		verified: contentStore.results.find((result) => result.unit.unitId === entry.unit.unitId)?.verification?.verified ?? null,
	}));
	const { artifacts, ...publication } = receipt;
	const report = { command: 'content publish', ok: receipt.verified, mode: planOnly ? 'plan' : 'apply', repository: `${identity.owner}/${identity.repository}`, ref, contentStore: contentStorePlan, receipt: { ...publication, artifactCount: artifacts.length } };
	return { exitCode: receipt.verified ? 0 : 1, stdout: context.outputFormat === 'json' || invocation.args.json === true ? [JSON.stringify(report, null, 2)] : [`Verified ${channel} content publication ${receipt.revision}.`], stderr: [], report };
}
