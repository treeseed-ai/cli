import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { integrateAgentCheckpoint } from '@treeseed/sdk/operations';
import type { TreeseedCommandContext, TreeseedParsedInvocation } from '../src/cli/types.ts';
import { runCapacityCheckpointIntegration } from '../src/cli/handlers/capacity-checkpoint-integration.ts';

function invocation(args: Record<string, unknown>): TreeseedParsedInvocation {
	return {
		commandName: 'capacity',
		args: { action: 'checkpoint-integrate', ...args },
		positionals: ['checkpoint-integrate'],
		rawArgs: [],
	};
}

const context: TreeseedCommandContext = {
	cwd: process.cwd(),
	env: {},
	write: () => undefined,
	spawn: () => ({ status: 0 }),
};
const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]) {
	return (await execFileAsync('git', args, { cwd })).stdout.trim();
}

describe('capacity checkpoint integration admission', () => {
	it('requires team and assignment scope before creating a Market client', async () => {
		const missingTeam = await runCapacityCheckpointIntegration(invocation({ assignment: 'assignment-a', plan: true }), context);
		assert.equal(missingTeam.exitCode, 1);
		assert.match(missingTeam.stderr?.join('\n') ?? '', /Missing --team/u);

		const missingAssignment = await runCapacityCheckpointIntegration(invocation({ team: 'team-a', plan: true }), context);
		assert.equal(missingAssignment.exitCode, 1);
		assert.match(missingAssignment.stderr?.join('\n') ?? '', /Missing --assignment/u);
	});

	it('requires exactly one explicit plan or execute mode before creating a Market client', async () => {
		for (const args of [
			{ team: 'team-a', assignment: 'assignment-a' },
			{ team: 'team-a', assignment: 'assignment-a', plan: true, execute: true },
		]) {
			const result = await runCapacityCheckpointIntegration(invocation(args), context);
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr?.join('\n') ?? '', /Choose exactly one of --plan or --execute/u);
		}
	});

	it('integrates and replays only the API-selected reviewed checkpoint through the public SDK operation', async () => {
		const root = await mkdtemp(join(tmpdir(), 'treeseed-cli-checkpoint-'));
		try {
			const repositoryPath = join(root, 'packages', 'sdk');
			await mkdir(repositoryPath, { recursive: true });
			await git(repositoryPath, 'init', '-b', 'task/checkpoint-canary');
			await git(repositoryPath, 'config', 'user.name', 'Treeseed Test');
			await git(repositoryPath, 'config', 'user.email', 'test@treeseed.local');
			await git(repositoryPath, 'remote', 'add', 'origin', 'https://github.com/treeseed-ai/sdk.git');
			await writeFile(join(repositoryPath, 'source.ts'), 'export const value = 1;\n');
			await git(repositoryPath, 'add', 'source.ts');
			await git(repositoryPath, 'commit', '-m', 'base');
			const baseCommit = await git(repositoryPath, 'rev-parse', 'HEAD');
			await git(repositoryPath, 'switch', '-c', 'assignment/checkpoint');
			await writeFile(join(repositoryPath, 'source.ts'), 'export const value = 2;\n');
			await git(repositoryPath, 'add', 'source.ts');
			await git(repositoryPath, 'commit', '-m', 'agent checkpoint');
			const checkpointCommit = await git(repositoryPath, 'rev-parse', 'HEAD');
			await git(repositoryPath, 'switch', 'task/checkpoint-canary');
			const assignment = {
				id: 'assignment-canary', projectId: 'project-sdk', status: 'completed', mode: 'acting',
				decisionInput: { input: { workGraphId: 'graph-canary', workGraphNodeId: 'implementation-canary' } },
				lifecycleOutput: { artifactManifest: {
					schemaVersion: 1, assignmentId: 'assignment-canary', modeRunId: 'mode-canary', teamId: 'team-a', projectId: 'project-sdk', providerId: 'provider-a', mode: 'acting',
					agentClassId: 'engineering', agentId: 'engineer', handlerId: 'actor', activityType: 'acting', status: 'completed', summary: 'Canary complete.', toolEvents: [], contentReferences: [],
					sourceWorktree: { baseRef: baseCommit, changedPaths: ['source.ts'] }, commit: { sha: checkpointCommit }, verification: [{ status: 'passed' }], citations: [], signals: [], usage: [], diagnostics: [], createdAt: new Date().toISOString(),
				} },
			};
			const graph = {
				id: 'graph-canary', projectId: 'project-sdk', decisionId: 'decision-canary', status: 'completed', metadata: { exactBaseRef: baseCommit },
				nodes: [
					{ id: 'implementation-canary', status: 'completed', metadata: { stage: 'implementation', producesDeliverableContractId: 'contract-implementation' } },
					{ id: 'verification-canary', status: 'completed', metadata: { stage: 'verification', producesDeliverableContractId: 'contract-verification' } },
					{ id: 'review-canary', status: 'completed', metadata: { stage: 'review', producesDeliverableContractId: 'contract-review' } },
					{ id: 'release-canary', status: 'completed', metadata: { stage: 'release', producesDeliverableContractId: 'contract-release' } },
				],
				deliverableContracts: ['contract-implementation', 'contract-verification', 'contract-review', 'contract-release'].map((id) => ({ id, status: 'approved' })),
			};
			const common = {
				workspaceRoot: root, assignment, graph, projectRepository: { checkoutPath: 'packages/sdk', url: 'https://github.com/treeseed-ai/sdk.git' },
				deliverableManifest: { id: 'deliverable:assignment-canary', deliverableContractId: 'contract-implementation', projectId: 'project-sdk', decisionId: 'decision-canary', sourceAuthority: { assignmentId: 'assignment-canary', modeRunId: 'mode-canary', baseRef: baseCommit, effectiveRef: checkpointCommit, checkpointCommit } },
			} as const;
			const planned = await integrateAgentCheckpoint({ ...common, mode: 'plan' });
			assert.equal(planned.ok, true);
			const integrated = await integrateAgentCheckpoint({ ...common, mode: 'execute' });
			assert.equal(integrated.ok, true);
			assert.equal(integrated.nextOperation, 'treeseed save');
			assert.equal(await git(repositoryPath, 'rev-parse', 'HEAD^{tree}'), await git(repositoryPath, 'rev-parse', `${checkpointCommit}^{tree}`));
			const replay = await integrateAgentCheckpoint({ ...common, mode: 'execute' });
			assert.equal(replay.alreadyIntegrated, true);
			const wrongAuthority = await integrateAgentCheckpoint({ ...common, deliverableManifest: { ...common.deliverableManifest, sourceAuthority: { ...common.deliverableManifest.sourceAuthority, assignmentId: 'assignment-other' } }, mode: 'plan' });
			assert.equal(wrongAuthority.ok, false);
			assert.ok(wrongAuthority.blockers.includes('Approved implementation deliverable does not select this assignment checkpoint authority.'));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
