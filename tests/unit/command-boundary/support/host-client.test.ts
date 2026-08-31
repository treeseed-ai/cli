import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { invokeLocalHostManager } from '../../../../src/cli/support/host-client.ts';

test('local host manager calls use fresh Unix-socket connections after long development operations', async () => {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-host-client-'));
	const socket = join(root, 'manager.sock'); let requests = 0;
	const server = createServer((request, response) => {
		request.resume(); request.on('end', () => {
			requests += 1; response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ ok: true, data: { request: requests }, error: null }));
		});
	});
	server.keepAliveTimeout = 1;
	await new Promise<void>((resolve) => server.listen(socket, resolve));
	try {
		assert.deepEqual(await invokeLocalHostManager({ operation: 'first' }, socket), { request: 1 });
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.deepEqual(await invokeLocalHostManager({ operation: 'second' }, socket), { request: 2 });
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});
