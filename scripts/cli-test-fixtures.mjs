import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const sdkFixtureRoot = resolve(scriptsRoot, '..', '..', 'sdk', 'src', 'treeseed', 'template-catalog', 'templates', 'starter-basic', 'template');

export function makeWorkspaceRoot() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-help-workspace-'));
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({
		name: 'help-test',
		private: true,
		workspaces: ['packages/*'],
	}, null, 2));
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Help Test
slug: help-test
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
`, 'utf8');
	return root;
}

export function makeTenantWorkspace(branch = 'staging') {
	const root = makeWorkspaceRoot();
	cpSync(sdkFixtureRoot, root, { recursive: true });
	mkdirSync(resolve(root, 'packages', 'placeholder'), { recursive: true });
	writeFileSync(resolve(root, 'packages', 'placeholder', 'package.json'), JSON.stringify({
		name: '@test/placeholder',
		version: '0.0.1',
	}, null, 2));
	spawnSync('git', ['init', '-b', branch], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['config', 'user.name', 'Treeseed Test'], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['config', 'user.email', 'treeseed@example.com'], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'ignore' });
	return root;
}
