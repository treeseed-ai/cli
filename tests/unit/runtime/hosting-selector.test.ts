import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
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
		expect(selector.serviceId).toBeUndefined();
		expect(selector.serviceType).toEqual(['content-store']);
		expect(selector.host).toEqual(['cloudflare']);
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

		expect(reconciliationRoot(workspaceRoot, 'admin')).toBe(adminRoot);
		expect(() => reconciliationRoot(workspaceRoot, 'missing')).toThrow('Unknown Treeseed application');
	});
});
