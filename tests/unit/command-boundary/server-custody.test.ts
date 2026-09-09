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
	updateServerSession,
} from '../../../src/cli/support/server-custody.ts';

test('server profiles and encrypted OAuth sessions remain CLI-local and redacted', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-custody-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		saveServerProfile({ serverId: 'test', label: 'Test', baseUrl: 'https://control.example.test' }, env);
		await saveServerSession({identity:{issuer:'https://identity.example.test/realms/local',subject:'user'},clientId:'trsd',scopes:[], serverId: 'test', audience: 'https://control.example.test', accessToken: 'secret-access', refreshToken: 'secret-refresh', principal: null }, env);
		await saveActiveTeam('test', { id: 'team-1', slug: 'treeseed', name: 'TreeSeed' }, env);
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
		assert.deepEqual(await lockServerCustody(env), { custody:'os',locked:true });
		assert.throws(()=>loadServerSession('test',env),/locked/);
		assert.equal(inspectServerCustody(env).locked,true);
		assert.deepEqual(await unlockServerCustody(env),{custody:'os',locked:false});
		assert.equal(loadServerSession('test', env)?.refreshToken, 'secret-refresh');
		await clearServerSession('test', env);
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

test('session transactions preserve concurrent server and team edits and invalidate failed renewals', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-transactions-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		await Promise.all(['one', 'two'].map(serverId => saveServerSession({identity:{issuer:'https://identity.example.test/realms/local',subject:'user'},clientId:'trsd',scopes:[],serverId, audience:'https://api.example.test', accessToken:'old', refreshToken:'refresh'}, env)));
		assert.deepEqual(inspectServerCustody(env).servers.map(entry => entry.serverId), ['one','two']);
		let release!: () => void;
		let entered!: () => void;
		const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
		const barrier = new Promise<void>(resolve => { release = resolve; });
		const renewal = updateServerSession('one', env, async current => {
			entered(); await barrier;
			return {...current!, accessToken:'new', refreshToken:'rotated'};
		});
		await enteredPromise;
		const selection = saveActiveTeam('one', {id:'team', slug:'team', name:'Team'}, env);
		release();
		await Promise.all([renewal, selection]);
		assert.equal(loadServerSession('one', env)?.refreshToken, 'rotated');
		assert.equal(loadServerSession('one', env)?.activeTeam?.id, 'team');
		await assert.rejects(updateServerSession('one', env, async () => { throw new Error('ambiguous renewal'); }, true), /ambiguous renewal/);
		assert.equal(loadServerSession('one', env), null);
		assert.equal(loadServerSession('two', env)?.accessToken, 'old');
		await assert.rejects(updateServerSession('two', env, async () => { throw new Error('invalid edit'); }), /invalid edit/);
		assert.equal(loadServerSession('two', env)?.accessToken, 'old');
	} finally { rmSync(root, {recursive:true, force:true}); }
});

test('logout waits for renewal and a queued renewal cannot resurrect a removed session', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-logout-race-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		await saveServerSession({identity:{issuer:'https://identity.example.test/realms/local',subject:'user'},clientId:'trsd',scopes:[],serverId:'one', audience:'https://api.example.test', accessToken:'old'}, env);
		let entered!: () => void;
		let release!: () => void;
		const started = new Promise<void>(resolve => { entered = resolve; });
		const barrier = new Promise<void>(resolve => { release = resolve; });
		const renewal = updateServerSession('one', env, async current => {
			entered(); await barrier; return {...current!, accessToken:'renewed'};
		});
		await started;
		const logout = clearServerSession('one', env);
		release();
		await Promise.all([renewal, logout]);
		await assert.rejects(updateServerSession('one', env, async current => {
			assert.equal(current, null);
			throw new Error('session ended');
		}, true), /session ended/);
		assert.equal(loadServerSession('one', env), null);
	} finally { rmSync(root, {recursive:true, force:true}); }
});
