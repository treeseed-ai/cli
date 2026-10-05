import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface HostEnrollment { clientId: string; privateKey: string; certificate: string; certificateAuthority: string }

function profileRoot(env: NodeJS.ProcessEnv) {
	const base = env.XDG_CONFIG_HOME ?? (env.HOME ? resolve(env.HOME, '.config') : null);
	if (!base) throw new Error('HOME or XDG_CONFIG_HOME is required for host credential custody.');
	return resolve(base, 'treeseed', 'hosts');
}

export function profileDirectory(env: NodeJS.ProcessEnv, profile = env.TREESEED_HOST_PROFILE ?? 'local') {
	if (!/^[a-z][a-z0-9-]{0,63}$/u.test(profile)) throw new Error('Host profile must be a lowercase portable identity.');
	return resolve(profileRoot(env), profile);
}

function privateWrite(path: string, value: string) {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.new`;
	writeFileSync(temporary, value, { mode: 0o600 });
	renameSync(temporary, path);
}

export function storeHostEnrollment(enrollment: HostEnrollment, endpoint: string, env: NodeJS.ProcessEnv) {
	const directory = profileDirectory(env);
	privateWrite(resolve(directory, 'client.key'), enrollment.privateKey);
	privateWrite(resolve(directory, 'client.crt'), enrollment.certificate);
	privateWrite(resolve(directory, 'ca.crt'), enrollment.certificateAuthority);
	privateWrite(resolve(directory, 'profile.json'), `${JSON.stringify({ schemaVersion: 'treeseed.host-client/v1', clientId: enrollment.clientId, endpoint }, null, 2)}\n`);
	return { profile: env.TREESEED_HOST_PROFILE ?? 'local', clientId: enrollment.clientId, endpoint, credentialDirectory: directory, privateKeyStored: true };
}
