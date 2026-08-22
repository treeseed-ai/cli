import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
	defaultLocalControlPlaneServer,
	normalizeControlPlaneServerRegistry,
	type ControlPlaneServerProfile,
	type ControlPlaneServerRegistry,
	type ControlPlaneServerSession,
} from '@treeseed/sdk/control-plane-client';

interface EncryptedSessions {
	version: 1;
	algorithm: 'aes-256-gcm';
	keyId: string;
	iv: string;
	tag: string;
	ciphertext: string;
}

interface SessionState { version: 1; sessions: ControlPlaneServerSession[] }
interface CustodyKeyring { version: 1; activeKeyId: string; keys: Array<{ id: string; value: string }> }

function custodyRoot(env: NodeJS.ProcessEnv) {
	return resolve(env.TREESEED_CONFIG_HOME || (env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME, 'treeseed') : resolve(env.HOME || homedir(), '.config', 'treeseed')));
}

function paths(env: NodeJS.ProcessEnv) {
	const root = custodyRoot(env);
	return { root, registry: resolve(root, 'servers.json'), key: resolve(root, 'custody.key'), sessions: resolve(root, 'sessions.enc') };
}

function atomicWrite(path: string, content: string, mode: number) {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, content, { encoding: 'utf8', mode });
	chmodSync(temporary, mode);
	renameSync(temporary, path);
}

function keyring(env: NodeJS.ProcessEnv, create: boolean): CustodyKeyring | null {
	const path = paths(env).key;
	if (!existsSync(path)) {
		if (!create) return null;
		const id = randomBytes(12).toString('hex');
		atomicWrite(path, `${JSON.stringify({ version: 1, activeKeyId: id, keys: [{ id, value: randomBytes(32).toString('base64') }] })}\n`, 0o600);
	}
	const ring = JSON.parse(readFileSync(path, 'utf8')) as CustodyKeyring;
	if (ring.version !== 1 || !ring.keys.some((entry) => entry.id === ring.activeKeyId)) throw new Error('TreeSeed custody keyring is invalid.');
	return ring;
}

function keyValue(ring: CustodyKeyring, keyId: string) {
	const entry = ring.keys.find((candidate) => candidate.id === keyId);
	const value = entry ? Buffer.from(entry.value, 'base64') : Buffer.alloc(0);
	if (value.length !== 32) throw new Error('TreeSeed session custody key is unavailable.');
	return value;
}

function readState(env: NodeJS.ProcessEnv): SessionState {
	const path = paths(env).sessions;
	if (!existsSync(path)) return { version: 1, sessions: [] };
	const ring = keyring(env, false);
	if (!ring) throw new Error('TreeSeed session custody key is missing.');
	const envelope = JSON.parse(readFileSync(path, 'utf8')) as EncryptedSessions;
	if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new Error('TreeSeed session custody format is unsupported.');
	const encryptionKey = keyValue(ring, envelope.keyId);
	const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(envelope.iv, 'base64'));
	decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
	const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
	const state = JSON.parse(plaintext.toString('utf8')) as SessionState;
	return { version: 1, sessions: Array.isArray(state.sessions) ? state.sessions : [] };
}

function writeState(state: SessionState, env: NodeJS.ProcessEnv, selected?: { id: string; value: Buffer }) {
	const ring = keyring(env, true)!;
	const keyId = selected?.id ?? ring.activeKeyId;
	const encryptionKey = selected?.value ?? keyValue(ring, keyId);
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
	const envelope: EncryptedSessions = { version: 1, algorithm: 'aes-256-gcm', keyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
	atomicWrite(paths(env).sessions, `${JSON.stringify(envelope)}\n`, 0o600);
}

export function loadServerRegistry(env: NodeJS.ProcessEnv): ControlPlaneServerRegistry {
	const path = paths(env).registry;
	if (!existsSync(path)) {
		const local = defaultLocalControlPlaneServer(env as Record<string, string | undefined>);
		return { version: 1, activeServerId: local.serverId, servers: [local] };
	}
	return normalizeControlPlaneServerRegistry(JSON.parse(readFileSync(path, 'utf8')) as ControlPlaneServerRegistry);
}

export function saveServerProfile(profile: ControlPlaneServerProfile, env: NodeJS.ProcessEnv) {
	const state = loadServerRegistry(env);
	const registry = normalizeControlPlaneServerRegistry({ version: 1, activeServerId: profile.serverId, servers: [...state.servers.filter((entry) => entry.serverId !== profile.serverId), profile] });
	atomicWrite(paths(env).registry, `${JSON.stringify(registry, null, 2)}\n`, 0o600);
}

export function loadServerSession(serverId: string, env: NodeJS.ProcessEnv) {
	return readState(env).sessions.find((session) => session.serverId === serverId) ?? null;
}

export function saveServerSession(session: ControlPlaneServerSession, env: NodeJS.ProcessEnv) {
	const state = readState(env);
	writeState({ version: 1, sessions: [...state.sessions.filter((entry) => entry.serverId !== session.serverId), session].sort((left, right) => left.serverId.localeCompare(right.serverId)) }, env);
}

export function clearServerSession(serverId: string, env: NodeJS.ProcessEnv) {
	const state = readState(env);
	writeState({ version: 1, sessions: state.sessions.filter((entry) => entry.serverId !== serverId) }, env);
}

export function inspectServerCustody(env: NodeJS.ProcessEnv) {
	const location = paths(env);
	const sessions = existsSync(location.sessions) ? readState(env).sessions : [];
	return { root: location.root, encrypted: existsSync(location.sessions), keyPresent: existsSync(location.key), servers: sessions.map((session) => ({ serverId: session.serverId, audience: session.audience, expiresAt: session.expiresAt ?? null, principal: session.principal ?? null })) };
}

export function rotateServerCustodyKey(env: NodeJS.ProcessEnv) {
	const state = readState(env);
	const current = keyring(env, true)!;
	const replacement = { id: randomBytes(12).toString('hex'), value: randomBytes(32) };
	const expanded: CustodyKeyring = { version: 1, activeKeyId: replacement.id, keys: [...current.keys, { id: replacement.id, value: replacement.value.toString('base64') }] };
	atomicWrite(paths(env).key, `${JSON.stringify(expanded)}\n`, 0o600);
	writeState(state, env, replacement);
	atomicWrite(paths(env).key, `${JSON.stringify({ version: 1, activeKeyId: replacement.id, keys: [{ id: replacement.id, value: replacement.value.toString('base64') }] })}\n`, 0o600);
	return { rotated: true, sessions: state.sessions.length };
}
