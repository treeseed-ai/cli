import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { OsSecretCustody, withOsCustodyLock } from '@treeseed/deployment/security/custody';
// Keep shared OS locking in this already-bundled Deployment custody boundary.
export { withOsCustodyLock };
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
export async function lockServerCustody(env:NodeJS.ProcessEnv) {return withOsCustodyLock(paths(env).custody,async()=>{custody(env).lock();return {custody:'os',locked:true};});}
export async function unlockServerCustody(env:NodeJS.ProcessEnv) {return withOsCustodyLock(paths(env).custody,async()=>{custody(env).unlock(true);return {custody:'os',locked:false};});}

/** Serialize the complete read/remote-operation/write transaction, not just the final write. */
export async function updateServerSession(
	serverId: string,
	env: NodeJS.ProcessEnv,
	update: (session: ControlPlaneServerSession | null) => Promise<ControlPlaneServerSession | null>,
	invalidateOnFailure = false,
) {
	return withOsCustodyLock(paths(env).custody, async () => {
		const state = readState(env);
		const previous = state.sessions.find(entry => entry.serverId === serverId) ?? null;
		const persist = (session: ControlPlaneServerSession | null) => {
			if (session && session.serverId !== serverId) throw new Error('Session transaction cannot change server identity.');
			writeState({version: 1, sessions: [...state.sessions.filter(entry => entry.serverId !== serverId), ...(session ? [session] : [])].sort((a,b) => a.serverId.localeCompare(b.serverId))}, env, state.custodyVersion);
		};
		let next: ControlPlaneServerSession | null;
		try { next = await update(previous); }
		catch (error) { if (invalidateOnFailure && previous) persist(null); throw error; }
		if (next !== previous) persist(next);
		return next;
	});
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

export function loadActiveTeam(serverId: string, env: NodeJS.ProcessEnv) {
	return loadServerSession(serverId, env)?.activeTeam ?? null;
}

export async function saveActiveTeam(serverId: string, team: { id: string; slug: string; name: string }, env: NodeJS.ProcessEnv) {
	await updateServerSession(serverId, env, async session => {
		if (!session?.accessToken) throw Object.assign(new Error(`Not logged in to ${serverId}.`), { category: 'authentication_required', code: 'authentication_required' });
		return { ...session, activeTeam: team };
	});
	return team;
}

export async function saveServerSession(session: ControlPlaneServerSession, env: NodeJS.ProcessEnv) {
	await updateServerSession(session.serverId, env, async () => session);
}

export async function clearServerSession(serverId: string, env: NodeJS.ProcessEnv) {
	await updateServerSession(serverId, env, async () => null);
}

export function inspectServerCustody(env: NodeJS.ProcessEnv) {
	const location = paths(env);
	const store = custody(env);
	const sessions = store.initialized && !store.locked ? readState(env).sessions : [];
	return { root: location.root, custody: 'os', encrypted: store.initialized, keyPresent: store.initialized, locked: store.locked, servers: sessions.map((session) => ({ serverId: session.serverId, audience: session.audience, expiresAt: session.expiresAt ?? null, principal: session.principal ?? null, activeTeam: session.activeTeam ?? null })) };
}
