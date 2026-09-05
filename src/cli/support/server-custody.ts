import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { OsSecretCustody } from '@treeseed/deployment/security/custody';
import { defaultLocalControlPlaneServer, normalizeControlPlaneServerRegistry,
  type ControlPlaneServerProfile, type ControlPlaneServerRegistry, type ControlPlaneServerSession } from '@treeseed/sdk/control-plane-client';
interface SessionState { version: 1; sessions: ControlPlaneServerSession[]; custodyVersion: number }
const scope = {team:'host',project:'cli',environment:'local',purpose:'oauth',name:'sessions'};
function paths(env: NodeJS.ProcessEnv) {
  const root = resolve(env.TREESEED_CONFIG_HOME || (env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME,'treeseed') : resolve(env.HOME || homedir(),'.config','treeseed')));
  return {root,registry:resolve(root,'servers.json'),custody:resolve(root,'custody')};
}
function custody(env:NodeJS.ProcessEnv) { return new OsSecretCustody(paths(env).custody,true); }
function atomicWrite(path:string,content:string,mode:number) {
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const temporary=`${path}.${process.pid}.tmp`;
  writeFileSync(temporary,content,{encoding:'utf8',mode,flag:'wx'});chmodSync(temporary,mode);renameSync(temporary,path);
}
function readState(env:NodeJS.ProcessEnv):SessionState {
  const store=custody(env);
  if(!store.initialized) {
    const root=paths(env).custody;
    if(existsSync(root)&&readdirSync(root).some(name=>name.endsWith('.enc')))
      throw new Error('OS custody key is missing; existing sessions cannot be recovered automatically.');
    return {version:1,sessions:[],custodyVersion:0};
  }
  return store.run(c=>{
    const record=c.read(scope); if(!record)return {version:1,sessions:[],custodyVersion:c.version(scope)};
    const state=JSON.parse(record.values.state!);
    if(state.version!==1||!Array.isArray(state.sessions))throw new Error('Invalid OS-custodied session state.');
    return {...state,custodyVersion:record.version};
  });
}
function writeState(state:Omit<SessionState,'custodyVersion'>,env:NodeJS.ProcessEnv,expectedVersion:number) {
  custody(env).run(c=>c.write(scope,{state:JSON.stringify(state)},expectedVersion),true);
}
export function lockServerCustody(env:NodeJS.ProcessEnv) {custody(env).lock();return {custody:'os',locked:true};}
export function unlockServerCustody(env:NodeJS.ProcessEnv) {custody(env).unlock(true);return {custody:'os',locked:false};}
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

export function loadActiveTeam(serverId: string, env: NodeJS.ProcessEnv) {
	return loadServerSession(serverId, env)?.activeTeam ?? null;
}

export function saveActiveTeam(serverId: string, team: { id: string; slug: string; name: string }, env: NodeJS.ProcessEnv) {
	const session = loadServerSession(serverId, env);
	if (!session?.accessToken) throw Object.assign(new Error(`Not logged in to ${serverId}.`), { category: 'authentication_required', code: 'authentication_required' });
	saveServerSession({ ...session, activeTeam: team }, env);
	return team;
}

export function saveServerSession(session: ControlPlaneServerSession, env: NodeJS.ProcessEnv) {
	const state = readState(env);
	writeState({ version: 1, sessions: [...state.sessions.filter((entry) => entry.serverId !== session.serverId), session].sort((left, right) => left.serverId.localeCompare(right.serverId)) }, env, state.custodyVersion);
}

export function clearServerSession(serverId: string, env: NodeJS.ProcessEnv) {
	const state = readState(env);
	writeState({ version: 1, sessions: state.sessions.filter((entry) => entry.serverId !== serverId) }, env, state.custodyVersion);
}

export function inspectServerCustody(env: NodeJS.ProcessEnv) {
	const location = paths(env);
	const store = custody(env);
	const sessions = store.initialized && !store.locked ? readState(env).sessions : [];
	return { root: location.root, custody: 'os', encrypted: store.initialized, keyPresent: store.initialized, locked: store.locked, servers: sessions.map((session) => ({ serverId: session.serverId, audience: session.audience, expiresAt: session.expiresAt ?? null, principal: session.principal ?? null, activeTeam: session.activeTeam ?? null })) };
}
