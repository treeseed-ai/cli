import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { authorizeHostedTopologyPlan, bindHostedStateBackend, hostedTopologyStateKey, planHostedTopology, planHostedTopologyRollback, planHostedTopologyRollbackExecution, verifyHostedTopologyReadback } from '@treeseed/sdk/deployment';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

const teamId = 'team-treeseed';
const now = '2026-09-02T12:00:00.000Z';
const declaration = {
	schemaVersion: 'treeseed.hosted-topology/v1' as const, id: 'production', teamId, deploymentId: 'treeseed-cloud', stackId: 'control-plane', environment: 'production' as const,
	mutation: 'approval-required' as const, platform: { repository: 'treeseed-ai/platform' as const, commit: 'a'.repeat(40) }, stateBackend: { connectionRef: 'cloudflare-state' }, providerConnections: {}, artifacts: {}, resources: [],
};
const backend = bindHostedStateBackend({ schemaVersion: 'treeseed.hosted-state-backend/v1', type: 's3', teamId, deploymentId: declaration.deploymentId, stackId: declaration.stackId, environment: declaration.environment,
	connectionRef: 'cloudflare-state', bucket: 'treeseed-state', key: hostedTopologyStateKey(declaration), region: 'auto', endpoint: 'https://example.r2.cloudflarestorage.com', usePathStyle: true, encryptionKeyRef: 'state-key' });
const plan = planHostedTopology({ declaration, observations: [], connections: {}, stateBackend: backend });
const planApproval = { schemaVersion: 'treeseed.hosted-topology-approval/v1' as const, planDigest: plan.planDigest, teamId, deploymentId: plan.deploymentId, stackId: plan.stackId, environment: plan.environment, backendBindingDigest: backend.bindingDigest, decision: 'approved' as const, approvedBy: 'owner', approvedAt: now };
const authorizedPlan = authorizeHostedTopologyPlan(plan);
const receipt = verifyHostedTopologyReadback({ plan: authorizedPlan, previousResources: [], resources: [], completedAt: now });
const rollback = planHostedTopologyRollback(receipt);
const targetPlan = planHostedTopology({ declaration, observations: [], connections: {}, stateBackend: backend });
const execution = planHostedTopologyRollbackExecution({ rollback, sourceReceipt: receipt, sourcePlan: plan, targetPlan });
const rollbackApproval = { schemaVersion: 'treeseed.hosted-topology-rollback-execution-approval/v1' as const,
	executionDigest: execution.executionDigest, teamId, deploymentId: execution.deploymentId, stackId: execution.stackId,
	environment: execution.environment, backendBindingDigest: execution.backendBindingDigest, decision: 'approved' as const,
	approvedBy: 'owner', approvedAt: now };

function fixture() {
	const root = mkdtempSync(resolve(tmpdir(), 'platform-topology-cli-'));
	writeFileSync(resolve(root, 'topology.yaml'), JSON.stringify(declaration));
	writeFileSync(resolve(root, 'plan.json'), JSON.stringify(plan));
	writeFileSync(resolve(root, 'plan-approval.json'), JSON.stringify(planApproval));
	writeFileSync(resolve(root, 'rollback.json'), JSON.stringify({ execution, sourcePlan: plan, targetPlan }));
	writeFileSync(resolve(root, 'rollback-approval.json'), JSON.stringify(rollbackApproval));
	return root;
}

test('platform topology commands use the active team and canonical API operations', async () => {
	const root = fixture(), calls: Array<{ operationId: string; input: any }> = [], output: string[] = [];
	try {
		const context = { cwd: root, env: { TREESEED_TEAM_ID: teamId }, interactiveUi: false, write: (value: string) => output.push(value), operationInvoke: async (operationId: string, input: any) => {
			calls.push({ operationId, input }); return { data: operationId.endsWith('.plan') ? plan : operationId.endsWith('.status') ? { receipt, operation: null } : { operationId: 'accepted' } };
		} };
		assert.equal(await runCommandLine(['platform', 'topology', 'plan', 'topology.yaml', '--json'], context), 0, output.join('\n'));
		assert.equal(await runCommandLine(['platform', 'topology', 'apply', 'plan.json', '--approval', 'plan-approval.json', '--yes', '--json'], context), 0);
		assert.equal(await runCommandLine(['platform', 'topology', 'status', '--json'], context), 0);
		assert.equal(await runCommandLine(['platform', 'topology', 'rollback', 'rollback.json', '--approval', 'rollback-approval.json', '--yes', '--json'], context), 0);
		assert.deepEqual(calls.map(({ operationId }) => operationId), ['infrastructure.topology.plan', 'infrastructure.topology.apply', 'infrastructure.topology.status', 'infrastructure.topology.rollback']);
		assert.ok(calls.every(({ input }) => input.path.teamId === teamId));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('platform topology rejects cross-team custody before invoking the API', async () => {
	const root = fixture(), output: string[] = [];
	try {
		const exit = await runCommandLine(['platform', 'topology', 'plan', 'topology.yaml', '--json'], { cwd: root, env: { TREESEED_TEAM_ID: 'other-team' }, interactiveUi: false, write: (value) => output.push(value), operationInvoke: async () => { throw new Error('must not invoke'); } });
		assert.equal(exit, 1); assert.equal(JSON.parse(output[0]!).error.code, 'topology_team_mismatch');
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('platform topology compiles a tracked portable template with runtime artifacts and active-team custody', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'platform-topology-template-cli-')), output: string[] = [], calls: any[] = [];
	const template = { schemaVersion: 'treeseed.hosted-topology-template/v1', id: 'staging', deploymentId: 'treeseed-cloud', stackId: 'control-plane', environment: 'staging', mutation: 'approval-required', stateBackend: { connectionRef: 'cloudflare-state' }, providerConnections: { cloudflare: { connectionRef: 'cloudflare-hosting' } }, artifactBindings: { admin: { input: 'admin-pages', kind: 'archive' } }, resources: [{ id: 'admin', provider: 'cloudflare', kind: 'pages-application', dependsOn: [], parameters: { name: { input: 'admin-project-name' }, artifact: { artifact: 'admin' }, 'artifact-format': { literal: 'tar+gzip' }, 'production-branch': { input: 'production-branch' }, 'destination-dir': { literal: '.' } }, adoption: { mode: 'adopt-or-create', replacement: 'forbidden' } }] };
	const artifacts = { schemaVersion: 'treeseed.hosted-topology-artifacts/v1', artifacts: { 'admin-pages': { kind: 'archive', format: 'tar+gzip', digest: `sha256:${'b'.repeat(64)}`, source: 'https://releases.example.test/admin.tgz' } } };
	try {
		writeFileSync(resolve(root, 'topology.yaml'), JSON.stringify(template)); writeFileSync(resolve(root, 'artifacts.json'), JSON.stringify(artifacts));
		execFileSync('git', ['init', '-q', root]); execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.test']); execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']); execFileSync('git', ['-C', root, 'add', 'topology.yaml']); execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture']);
		const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
		const exit = await runCommandLine(['platform', 'topology', 'plan', 'topology.yaml', '--artifacts', 'artifacts.json', '--json'], { cwd: root, env: { TREESEED_TEAM_ID: teamId }, interactiveUi: false, write: (value) => output.push(value), operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: plan }; } });
		assert.equal(exit, 0, output.join('\n')); assert.equal(calls[0].input.body.declaration.teamId, teamId); assert.equal(calls[0].input.body.declaration.platform.commit, commit); assert.equal(calls[0].input.body.declaration.artifacts.admin.kind, 'archive');
		writeFileSync(resolve(root, 'topology.yaml'), `${JSON.stringify(template)}\n`);
		assert.equal(await runCommandLine(['platform', 'topology', 'plan', 'topology.yaml', '--artifacts', 'artifacts.json', '--json'], { cwd: root, env: { TREESEED_TEAM_ID: teamId }, interactiveUi: false, write: (value) => output.push(value), operationInvoke: async () => { throw new Error('must not invoke'); } }), 1);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
