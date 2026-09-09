import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createControlPlaneClient } from '../../../../src/cli/support/client.ts';
import { loadServerSession, saveServerProfile, saveServerSession } from '../../../../src/cli/support/server-custody.ts';
import type { CommandContext } from '../../../../src/cli/types.ts';

for (const rejectRenewal of [false, true]) test(`concurrent renewal is single-use and invalidates ambiguity (${rejectRenewal})`, async () => {
	let requests = 0;
	let baseUrl = '';
	const server = createServer((request, response) => {
		request.resume();
		request.once('end', () => {
			requests++;
			response.setHeader('content-type', 'application/json');
			if (rejectRenewal) { response.writeHead(503); response.end(JSON.stringify({error:'temporarily_unavailable'})); }
			else response.end(JSON.stringify({token_type:'Bearer', access_token:'renewed', refresh_token:'rotated', expires_in:600, scope:'treeseed:read', audience:baseUrl}));
		});
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address(); assert.ok(address && typeof address !== 'string');
	baseUrl = `http://127.0.0.1:${address.port}`;
	const root = mkdtempSync(join(tmpdir(), 'treeseed-cli-renewal-'));
	const env = { TREESEED_CONFIG_HOME: root };
	const context: CommandContext = {cwd:root, env, write:()=>{}, outputFormat:'json', interactiveUi:false};
	try {
		saveServerProfile({serverId:'test', label:'Test', baseUrl}, env);
		await saveServerSession({serverId:'test', audience:baseUrl, accessToken:'expired', refreshToken:'old', expiresAt:'2020-01-01T00:00:00.000Z'}, env);
		const results = await Promise.allSettled([1,2].map(() => createControlPlaneClient({options:{server:'test'}}, context, true, true)));
		assert.equal(requests, 1);
		assert.ok(results.every(result => result.status === (rejectRenewal ? 'rejected' : 'fulfilled')));
		assert.equal(loadServerSession('test', env)?.refreshToken ?? null, rejectRenewal ? null : 'rotated');
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
		rmSync(root, {recursive:true, force:true});
	}
});
