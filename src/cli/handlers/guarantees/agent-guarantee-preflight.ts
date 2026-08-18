import { accessSync,appendFileSync,constants,existsSync,mkdirSync,readFileSync,statfsSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAgentGuaranteeCatalogStatus,planGuarantees,type GuaranteeFilter } from '@treeseed/sdk/guarantees';
import { runManagedDev } from '@treeseed/sdk';
import type { CommandHandler,CommandContext,ParsedInvocation } from '../../operations/operations-types.ts';
import { runCapacityLifecycleAction } from '../capacity/capacity-core/capacity-runtime.ts';
import { handleDev } from '../runtime/dev.ts';

export type AgentGuaranteeExecutionProviderMode = 'live-codex' | 'auto';
export function codexAuthAvailable(env: NodeJS.ProcessEnv) {
	const explicit = env.TREESEED_CODEX_AUTH_FILE || env.CODEX_AUTH_FILE;
	if (explicit?.trim()) return existsSync(explicit);
	const home = env.HOME || process.env.HOME;
	return Boolean(home && existsSync(`${home}/.codex/auth.json`));
}

export function applyAgentGuaranteeExecutionProviderMode(input: { environment: string; env: NodeJS.ProcessEnv }) {
	const configured = input.env.TREESEED_AGENT_GUARANTEE_EXECUTION_PROVIDER?.trim();
	const mode: AgentGuaranteeExecutionProviderMode = configured === 'live-codex' || configured === 'auto' ? configured
		: input.env.CI === 'true' || input.env.GITHUB_ACTIONS === 'true' || input.environment === 'staging' ? 'live-codex' : 'auto';
	input.env.TREESEED_AGENT_GUARANTEE_EXECUTION_PROVIDER = mode;
	if (!codexAuthAvailable(input.env)) return { ok: false, diagnostics: [`missing_codex_auth: ${mode === 'live-codex' ? 'live Codex agent guarantees require ~/.codex/auth.json or TREESEED_CODEX_AUTH_FILE' : 'agent guarantees require a real execution provider; no mock or synthetic provider fallback is permitted'}.`] };
	input.env.TREESEED_AGENT_EXECUTION_PROVIDER = 'codex';
	return { ok: true, diagnostics: [`Agent guarantee ${mode} mode selected the authenticated Codex execution provider.`] };
}

function needsLocalDev(input: { filter: GuaranteeFilter; includeDependencies?: boolean; cwd: string }) {
	const plan = planGuarantees({ workspaceRoot: input.cwd, filter: input.filter, environment: 'local', includeDependencies: input.includeDependencies });
	return plan.entries.some((entry) => entry.status === 'active' && Boolean(entry.sceneManifest || entry.apiVerifierRefs.length));
}

export async function ensureLocalDevForGuaranteeRun(context: Parameters<CommandHandler>[1], input: { filter: GuaranteeFilter; includeDependencies?: boolean; includePlanned?: boolean }, runDev: typeof runManagedDev = runManagedDev) {
	if (process.env.TREESEED_GUARANTEE_SKIP_LOCAL_DEV === '1' || !needsLocalDev({ filter: input.filter, includeDependencies: input.includeDependencies, cwd: context.cwd })) return { ok: true, diagnostics: [] as string[] };
	if(runDev===runManagedDev){const result=await handleDev({commandName:'dev',positionals:['start'],rawArgs:[],args:{app:'api',forceConflicts:true}},context);return result.exitCode===0&&result.report?.ok===true?{ok:true,diagnostics:['Canonical managed API/operations source closures and health were verified before local guarantee execution.']}:{ok:false,diagnostics:['Managed local dev startup failed. Reconcile API/operations exact source closures and retry.']};}
	const result = await runDev({ action: 'start', cwd: context.cwd, surfaces: 'web,api', webRuntime: 'local', force: false, forceConflicts: true, env: context.env });
	return result.ok
		? { ok: true, diagnostics: ['Managed local dev web/API source closures and health were verified before local guarantee execution.'] }
		: { ok: false, diagnostics: ['Managed local dev startup failed. Reconcile API/web exact source closures and retry.'] };
}

type Check = { id:string; ok:boolean; detail:string; evidence?:unknown };
type Row=Record<string,unknown>;
const record=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
export function providerPin(status:Row){const found:{sessionIds:string[];sourceClosureDigests:string[];imageIds:string[];configHashes:string[]}={sessionIds:[],sourceClosureDigests:[],imageIds:[],configHashes:[]};const visit=(value:unknown,key='')=>{if(Array.isArray(value)){value.forEach((entry)=>visit(entry,key));return;}if(!value||typeof value!=='object')return;for(const [name,entry]of Object.entries(value as Row)){if(typeof entry==='string'){if(name==='sourceClosureDigest'||name==='org.treeseed.source-closure')found.sourceClosureDigests.push(entry);if(name==='imageId')found.imageIds.push(entry);if(name==='configHash')found.configHashes.push(entry);if(name==='id'&&key==='availabilitySession')found.sessionIds.push(entry);}visit(entry,name);}};visit(status);return Object.fromEntries(Object.entries(found).map(([key,values])=>[key,[...new Set(values)].sort()]));}
function statusInvocation(): ParsedInvocation { return { commandName:'capacity',positionals:['status'],rawArgs:[],args:{provider:'local',market:'local'} }; }
async function health(baseUrl:string) {
	try { const response=await fetch(`${baseUrl.replace(/\/$/u,'')}/healthz/deep`,{signal:AbortSignal.timeout(3_000)});const body=await response.json().catch(()=>({})) as Record<string,unknown>;const checks=(body.checks&&typeof body.checks==='object'?body.checks:{}) as Record<string,unknown>;return {ok:response.ok,detail:`HTTP ${response.status}`,database:checks.database===true}; }
	catch(error){return {ok:false,detail:error instanceof Error?error.message:String(error)};}
}

export async function handleAgentGuaranteePreflight(context: CommandContext) {
	const generation=createAgentGuaranteeCatalogStatus({workspaceRoot:context.cwd,catalog:'agent.system'}).generation;
	const checks:Check[]=[]; const apiBase=context.env.TREESEED_API_BASE_URL?.trim()||'http://127.0.0.1:3000';
	const dev=await handleDev({commandName:'dev',positionals:['status'],rawArgs:[],args:{app:'api'}},context);const managedReady=dev.exitCode===0&&(dev.report?.ok===true);
	for(const surface of ['api','operations-runner'])checks.push({id:surface,ok:managedReady,detail:managedReady?'canonical managed reconcile status is ready':'canonical managed reconcile status reports drift'});
	const api=await health(apiBase);checks.push({id:'api-health',...api});
	checks.push({id:'postgresql',ok:api.ok&&api.database===true,detail:api.database===true?'deep health database probe passed':'deep health database probe failed'});
	const capacity=await runCapacityLifecycleAction('status',statusInvocation(),context); const capacityReport=capacity.report as Record<string,unknown>|undefined; const status=(capacityReport?.status??{}) as Record<string,unknown>;
	checks.push({id:'provider-manager-and-treedx',ok:status.ready===true,detail:status.ready===true?'managed provider resources are ready':`blockers=${JSON.stringify(status.blockers??[])}`});
	const root=resolve(context.cwd,'.treeseed/guarantees/campaigns',generation);mkdirSync(root,{recursive:true});const pinPath=resolve(root,'provider-runtime-pin.json');const observedPin=providerPin(status);
	if(existsSync(pinPath)){const pinned=JSON.parse(readFileSync(pinPath,'utf8')) as Row;const unchanged=JSON.stringify(record(pinned.provider))===JSON.stringify(observedPin);checks.push({id:'pinned-warm-provider',ok:unchanged,detail:unchanged?'warm provider source closure matches the pinned campaign':'live provider session/source closure differs from the campaign pin',evidence:observedPin});}
	else{const pinnable=status.ready===true&&observedPin.sourceClosureDigests.length>0&&observedPin.imageIds.length>0;if(pinnable)writeFileSync(pinPath,`${JSON.stringify({schemaVersion:'treeseed.agent-guarantee-provider-pin/v1',generation,pinnedAt:new Date().toISOString(),provider:observedPin},null,2)}\n`,{mode:0o600});checks.push({id:'pinned-warm-provider',ok:pinnable,detail:pinnable?'pinned exact warm-provider sessions and source closures for this campaign':'provider must be fully reconciled before its source closure can be pinned',evidence:observedPin});}
	const auth=codexAuthAvailable(context.env);checks.push({id:'codex-authentication',ok:auth,detail:auth?'authenticated credential file is present':'Codex auth file is missing'});
	for(const [id,path] of [['project-binding','treeseed.site.yaml'],['provider-manifest','treeseed.agents-capacity-provider.yaml']] as const)checks.push({id,ok:existsSync(resolve(context.cwd,path)),detail:path});
	try{accessSync(context.cwd,constants.R_OK|constants.W_OK);const disk=statfsSync(context.cwd);const available=Number(disk.bavail)*Number(disk.bsize);checks.push({id:'isolation-disk-reserve',ok:available>=5*1024**3,detail:`${Math.floor(available/1024**3)} GiB available`});}catch(error){checks.push({id:'isolation-disk-reserve',ok:false,detail:error instanceof Error?error.message:String(error)});}
	const remote=spawnSync('git',['ls-remote','--exit-code','origin','HEAD'],{cwd:context.cwd,encoding:'utf8',timeout:10_000});checks.push({id:'remote-read-access',ok:remote.status===0,detail:remote.status===0?'origin HEAD observed':(remote.stderr||'origin unavailable').trim()});
	const ok=checks.every((check)=>check.ok);
	appendFileSync(resolve(root,'journal.jsonl'),`${JSON.stringify({schemaVersion:'treeseed.agent-guarantee-campaign-event/v1',type:'preflight',observedAt:new Date().toISOString(),generation,ok,checks})}\n`,{mode:0o600});
	return {exitCode:ok?0:1,stdout:[ok?'Agent guarantee preflight passed.':'Agent guarantee preflight is blocked.',`Checks: ${checks.filter((check)=>check.ok).length}/${checks.length}`],stderr:[],report:{command:'guarantees preflight',ok,generation,checks,providerObservation:status,blockers:checks.filter((check)=>!check.ok).map((check)=>({id:check.id,detail:check.detail}))}};
}
