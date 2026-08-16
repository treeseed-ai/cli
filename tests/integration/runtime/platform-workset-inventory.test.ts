import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPlatformWorksetInventory } from '../../../src/cli/handlers/runtime/platform-workset-inventory.ts';
import { governedWorksetAuthority } from '../../../src/cli/handlers/runtime/run.ts';

test('Platform workset resolves a team and selects only managed software and fixture repositories', async () => {
		const client = {
			async request(path: string) {
				if (path.includes('/profile')) return { payload: { team: { id: 'team-a', slug: 'treeseed' } } };
				return { payload: { teamId: 'team-a', projects: [
					{ id: 'project-api', metadata: { repository: { checkoutPath: 'packages/api', repositoryPolicy: { stagingBranch: 'staging' } } }, repositories: [
						{ role: 'primary', owner: 'treeseed-ai', name: 'api', currentBranch: 'staging' },
						{ role: 'content', owner: 'treeseed-ai', name: 'api-content', currentBranch: 'staging' },
					] },
					{ id: 'project-platform', metadata: { repository: { checkoutPath: '.' } }, repositories: [
						{ role: 'primary', owner: 'treeseed-ai', name: 'platform', currentBranch: 'staging' },
						{ role: 'fixture', owner: 'treeseed-ai', name: 'fixtures', currentBranch: 'staging', submodulePath: '.fixtures/treeseed-fixtures' },
					] },
					{ id: 'project-market', metadata: { repository: { checkoutPath: 'packages/market' } }, repositories: [
						{ role: 'primary', owner: 'treeseed-ai', name: 'market', currentBranch: 'staging' },
					] },
				] } };
			},
		};
		assert.deepEqual(await loadPlatformWorksetInventory(client as never, 'treeseed'), {
			teamId: 'team-a',
			inventory: [
				{ projectId: 'project-api', role: 'primary', path: 'packages/api', repository: 'treeseed-ai/api', branch: 'staging' },
				{ projectId: 'project-platform', role: 'fixture', path: '.fixtures/treeseed-fixtures', repository: 'treeseed-ai/fixtures', branch: 'staging' },
			],
		});
});

test('writable Platform workset custody is compiled only from a matching active acting assignment and plan',async () => {
	const baseCommit = 'a'.repeat(40);
	const client = {
		async capacityProviderAssignment() { return { payload: {
			teamId:'team-a',projectId:'project-api',decisionId:'decision-a',workDayId:'run-a',mode:'acting',status:'leased',
			leaseExpiresAt:'2099-01-01T00:00:00.000Z',decisionInput:{ input:{ exactBaseRef:baseCommit } },
			metadata:{ capacityPlanId:'plan-a' },capabilityHandles:{ repository:[{ expiresAt:'2099-01-02T00:00:00.000Z' }] },
		} }; },
		async capacityPlan() { return { payload:{ id:'plan-a',teamId:'team-a',projectId:'project-api',decisionId:'decision-a',status:'scheduled' } }; },
	};
	assert.deepEqual(await governedWorksetAuthority(client as never,'team-a','assignment-a'),{
		schemaVersion:1,kind:'treeseed.governed-workset-authority',status:'active',teamId:'team-a',projectId:'project-api',
		decisionId:'decision-a',capacityPlanId:'plan-a',workDayId:'run-a',assignmentId:'assignment-a',mode:'acting',
		baseCommit,expiresAt:'2099-01-01T00:00:00.000Z',
	});
});

test('writable Platform workset custody rejects a capacity plan from another project',async () => {
	const client = {
		async capacityProviderAssignment() { return { payload:{ teamId:'team-a',projectId:'project-api',decisionId:'decision-a',workDayId:'run-a',
			mode:'acting',status:'running',leaseExpiresAt:'2099-01-01T00:00:00.000Z',decisionInput:{ input:{ exactBaseRef:'a'.repeat(40) } },metadata:{ capacityPlanId:'plan-a' },capabilityHandles:{} } }; },
		async capacityPlan() { return { payload:{ id:'plan-a',teamId:'team-a',projectId:'project-sdk',decisionId:'decision-a',status:'accepted' } }; },
	};
	await assert.rejects(governedWorksetAuthority(client as never,'team-a','assignment-a'),/does not govern this assignment/u);
});
