import { readFileSync } from 'node:fs';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { resolve } from 'node:path';
import { profileDirectory } from './host-custody.js';

const managerSocket = '/run/treeseed/manager/api.sock';

interface ManagerEnvelope { ok: boolean; data: unknown; error: null | { code: string; message: string } }

function profileEndpoint(directory: string) {
	const value = JSON.parse(readFileSync(resolve(directory, 'profile.json'), 'utf8')) as { endpoint?: unknown };
	if (typeof value.endpoint !== 'string') throw new Error('Host profile does not contain an endpoint.');
	return value.endpoint;
}

function invoke(options: Parameters<typeof requestHttp>[0], body: string, secure: boolean) {
	return new Promise<unknown>((resolvePromise, reject) => {
		const request = (secure ? requestHttps : requestHttp)({ ...options, method: 'POST', path: '/v1/host/commands', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (response) => {
			const chunks: Buffer[] = [];
			response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
			response.on('end', () => {
				try {
					const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ManagerEnvelope;
					if (!envelope.ok) throw Object.assign(new Error(envelope.error?.message ?? 'Host manager rejected the command.'), { status: response.statusCode, code: envelope.error?.code ?? 'host_command_rejected' });
					resolvePromise(envelope.data);
				} catch (error) { reject(error); }
			});
		});
		request.on('error', reject);
		request.end(body);
	});
}

export function invokeLocalHostManager(input: unknown) {
	return invoke({ socketPath: managerSocket }, JSON.stringify(input), false);
}

export function invokeHostManager(input: unknown, server: string | undefined, env: NodeJS.ProcessEnv) {
	if (!server && !env.TREESEED_HOST_URL) return invokeLocalHostManager(input);
	const directory = profileDirectory(env, server && !server.includes('://') ? server : undefined);
	const endpoint = server?.includes('://') ? server : server ? profileEndpoint(directory) : env.TREESEED_HOST_URL ?? profileEndpoint(directory);
	const target = new URL(endpoint);
	if (target.protocol !== 'https:') throw new Error('Remote host manager endpoints must use HTTPS with mTLS.');
	return invoke({ protocol: target.protocol, hostname: target.hostname, port: target.port || 443,
		ca: readFileSync(env.TREESEED_HOST_CA ?? resolve(directory, 'ca.crt')),
		cert: readFileSync(env.TREESEED_HOST_CERT ?? resolve(directory, 'client.crt')),
		key: readFileSync(env.TREESEED_HOST_KEY ?? resolve(directory, 'client.key')),
		rejectUnauthorized: true }, JSON.stringify(input), true);
}
