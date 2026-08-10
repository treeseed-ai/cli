import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach,describe,it } from 'node:test';
import { reconciliationRoot,selectorFromHostingGraph } from '../../../src/cli/handlers/hosting/hosting-support.ts';

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('hosting reconciliation selector', () => {
	it('selects Cloudflare resource types without excluding units that have no service id', () => {
		const graph = {
			units: [{
				id: 'content-storage', placement: 'content-storage',
				host: { id: 'cloudflare' }, serviceType: { id: 'object-store' }, config: {},
			}],
		} as never;
		const selector = selectorFromHostingGraph(graph);
		assert.equal(selector.serviceId, undefined);
		assert.deepEqual(selector.serviceType, ['content-store']);
		assert.deepEqual(selector.host, ['cloudflare']);
	});

	it('scopes reconciliation to the selected application repository', () => {
		const workspaceRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-hosting-selector-'));
		temporaryRoots.push(workspaceRoot);
		const adminRoot = resolve(workspaceRoot, 'packages/admin');
		mkdirSync(adminRoot, { recursive: true });
		writeFileSync(resolve(workspaceRoot, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
		writeFileSync(resolve(adminRoot, 'treeseed.site.yaml'), [
			'name: Admin',
			'slug: admin',
			'siteUrl: https://admin.example.test',
			'contactEmail: admin@example.test',
			'hosting:',
			'  kind: self_hosted_project',
			'  projectId: admin',
			'surfaces:',
			'  web:',
			'    enabled: true',
			'    provider: cloudflare',
		].join('\n'));

		assert.equal(reconciliationRoot(workspaceRoot, 'admin'), adminRoot);
		assert.throws(() => reconciliationRoot(workspaceRoot, 'missing'), /Unknown Treeseed application/u);
	});
});
