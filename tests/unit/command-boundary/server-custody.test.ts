import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { controlPlaneServerRegistry } from '../../../src/cli/support/client.ts';
import {
	clearServerSession,
	inspectServerCustody,
	loadServerSession,
	lockServerCustody,
	unlockServerCustody,
	saveActiveTeam,
	saveServerProfile,
	saveServerSession,
} from '../../../src/cli/support/server-custody.ts';

test('server profiles and encrypted OAuth sessions remain CLI-local and redacted', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-custody-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		saveServerProfile({ serverId: 'test', label: 'Test', baseUrl: 'https://control.example.test' }, env);
		saveServerSession({ serverId: 'test', audience: 'https://control.example.test', accessToken: 'secret-access', refreshToken: 'secret-refresh', principal: null }, env);
		saveActiveTeam('test', { id: 'team-1', slug: 'treeseed', name: 'TreeSeed' }, env);
		assert.equal(loadServerSession('test', env)?.accessToken, 'secret-access');
		assert.equal(loadServerSession('test', env)?.activeTeam?.slug, 'treeseed');
		const record = readdirSync(resolve(root,'custody')).find(name=>name.endsWith('.enc'))!;
		const ciphertext = readFileSync(resolve(root, 'custody',record), 'utf8');
		assert.equal(ciphertext.includes('secret-access'), false);
		assert.equal(ciphertext.includes('secret-refresh'), false);
		assert.equal(ciphertext.includes('treeseed'), false);
		assert.equal(statSync(resolve(root, 'custody',record)).mode & 0o777, 0o600);
		assert.equal(statSync(resolve(root, 'custody','custody.cred')).mode & 0o777, 0o600);
		assert.equal(existsSync(resolve(root,'custody.key')),false);
		assert.deepEqual(inspectServerCustody(env).servers.map((entry) => entry.serverId), ['test']);
		assert.equal(JSON.stringify(inspectServerCustody(env)).includes('secret-access'), false);
		assert.deepEqual(lockServerCustody(env), { custody:'os',locked:true });
		assert.throws(()=>loadServerSession('test',env),/locked/);
		assert.equal(inspectServerCustody(env).locked,true);
		assert.deepEqual(unlockServerCustody(env),{custody:'os',locked:false});
		assert.equal(loadServerSession('test', env)?.refreshToken, 'secret-refresh');
		clearServerSession('test', env);
		assert.equal(loadServerSession('test', env), null);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('saved local control-plane profile remains active unless the environment explicitly overrides it', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-local-profile-'));
	try {
		const env = { TREESEED_CONFIG_HOME: root };
		saveServerProfile({ serverId: 'local', label: 'Local development edge', baseUrl: 'https://api.treeseed.localhost' }, env);
		assert.equal(controlPlaneServerRegistry({ env }).servers.find((entry) => entry.serverId === 'local')?.baseUrl, 'https://api.treeseed.localhost');
		const overridden = { ...env, TREESEED_API_BASE_URL: 'http://127.0.0.1:3002' };
		assert.equal(controlPlaneServerRegistry({ env: overridden }).servers.find((entry) => entry.serverId === 'local')?.baseUrl, 'http://127.0.0.1:3002');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
