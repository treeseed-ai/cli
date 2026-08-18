import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadLocalPlatformWorksetInventory, loadPlatformWorksetInventory } from '../../../src/cli/handlers/runtime/platform-workset-inventory.ts';
import { governedWorksetAuthority, handlePlatform } from '../../../src/cli/handlers/runtime/run.ts';
import { localSeedApplyPreference } from '../../../src/cli/handlers/seeds/seed.ts';

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

test('Platform workset compiles local seed inventory without Market or content custody', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-local-workset-'));
	try {
		mkdirSync(resolve(root, 'seeds'));
		const policy = { visibility: 'public', lifecycle: 'create-or-adopt', deletionPolicy: 'retain', defaultBranch: 'main', stagingBranch: 'staging', issues: true, actions: true, workflows: ['verify.yml'] };
		const architecture = { topology: 'split_site_content', rootPath: '.', sitePath: 'docs', contentPath: 'src/content', contentRuntimeSource: 'r2_preview_overlay', localContentMaterialization: 'none', requiresLocalContentForCi: false, requiresLocalContentForDeploy: false, contentPublishTarget: { kind: 'cloudflare_r2', prefix: 'fixture' } };
		const project = (team: string, slug: string, name = slug) => ({
			key: `project:${team.split(':')[1]}/${slug}`, team, slug, name,
			repository: { role: 'primary', provider: 'github', owner: 'treeseed-ai', name: slug, gitUrl: `https://github.com/treeseed-ai/${slug}.git`, defaultBranch: 'main', checkoutPath: slug === 'platform' ? '.' : `packages/${slug}`, repositoryPolicy: policy },
			architecture,
		});
		writeFileSync(resolve(root, 'seeds/treeseed.yaml'), JSON.stringify({
			name: 'treeseed', version: 1, defaultEnvironments: ['local'], environments: ['local'],
			resources: {
				teams: [
					{ key: 'team:treeseed', slug: 'treeseed', name: 'treeseed', displayName: 'TreeSeed' },
					{ key: 'team:other', slug: 'other', name: 'other', displayName: 'Other' },
				],
				projects: [project('team:treeseed', 'platform'), project('team:treeseed', 'api'), project('team:treeseed', 'market'), project('team:treeseed', 'docs-content'), project('team:other', 'other-package')],
				hubRepositories: [{ key: 'repository:treeseed/fixtures', project: 'project:treeseed/platform', role: 'fixture', provider: 'github', owner: 'treeseed-ai', name: 'fixtures', gitUrl: 'https://github.com/treeseed-ai/fixtures.git', defaultBranch: 'main', currentBranch: 'staging', submodulePath: '.fixtures/treeseed-fixtures', status: 'active', repositoryPolicy: policy }],
			},
		}));
		assert.deepEqual(loadLocalPlatformWorksetInventory(root, 'treeseed'), {
			teamId: 'team:treeseed',
			inventory: [
				{ projectId: 'project:treeseed/api', role: 'primary', path: 'packages/api', repository: 'https://github.com/treeseed-ai/api.git', branch: 'staging' },
				{ projectId: 'project:treeseed/platform', role: 'fixture', path: '.fixtures/treeseed-fixtures', repository: 'https://github.com/treeseed-ai/fixtures.git', branch: 'staging' },
			],
			inventorySource: 'local-seed',
			seedPath: 'seeds/treeseed.yaml',
		});
		mkdirSync(resolve(root, 'packages/nested'), { recursive: true });
		assert.equal(loadLocalPlatformWorksetInventory(root, 'treeseed').inventory.length, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('Market-disabled writable workset returns a stable local-control-plane requirement', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-local-workset-authority-'));
	try {
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'market: { profile: treeseed }\ndevelopment: { local: { marketConnectivity: disabled, inventory: { source: seed } } }\n');
		const result = await handlePlatform({ commandName: 'platform', args: { branch: 'codex/test', assignment: 'assignment-a' }, positionals: ['workset'], rawArgs: [] }, {
			cwd: root, env: {}, outputFormat: 'json', write() {}, spawn: (() => { throw new Error('unexpected spawn'); }) as never,
		});
		assert.equal(result.exitCode, 1);
		assert.equal(result.report?.code, 'control_plane_required_for_writable_workset');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('Market-disabled local seed apply prefers the direct store adapter', () => {
	assert.equal(localSeedApplyPreference(false, true), 'direct');
	assert.equal(localSeedApplyPreference(true, true), 'api');
	assert.equal(localSeedApplyPreference(true, false), 'direct');
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
