import { createAgentGuaranteeCatalogStatus } from '@treeseed/sdk/guarantees';
import { appendFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CommandContext,ParsedInvocation } from '../../../../types.js';
import { createMarketClientForInvocation } from '../../../content/market-utils.js';
import { fail } from '../../../utilities/utils.js';
import { capacityNumberArg as numberArg,capacityStringArg as text } from '../../capacity-core/capacity-command-arguments.js';
import { resolveCapacityTeam } from '../../capacity-core/capacity-market-context.js';

type Row=Record<string,unknown>;
const record=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const rows=(value:unknown)=>Array.isArray(value)?value.map(record):[];
const string=(value:unknown)=>typeof value==='string'?value:'';

export function coordinatedWorkdayWatchPayload(run:Row,assignments:Row[]) {
	const normalized=assignments.map((entry)=>{const cleanup=record(entry.cleanup);const manifest=record(record(entry.lifecycleOutput).artifactManifest);const unpublished=rows(manifest.contentReferences).length>0&&rows(entry.contentIntegrations).every((item)=>item.readBackVerified!==true);return {...entry,cleanup:{...cleanup,...(unpublished?{unpublishedBranches:Math.max(1,Number(cleanup.unpublishedBranches??0))}:{})}};});
	const statuses=['completed','failed','cancelled','returned','leased','queued'] as const;const counts=Object.fromEntries(statuses.map((status)=>[status,normalized.filter((entry)=>string(entry.status)===status).length]));
	return {workday:run,totals:{assignments:{total:normalized.length,...counts}},evidence:{assignments:{items:normalized}}};
}

async function readCoordinatedWorkday(client:any,teamId:string,workdayId:string) {
	const run=record(record(await client.workdayRun(teamId,workdayId)).payload).run as Row;const assignments:Row[]=[];let cursor='';
	do {const query=new URLSearchParams({workdayId,limit:'200',...(cursor?{cursor}:{})});const response=await client.request(`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments?${query}`,{requireAuth:true});const payload=record(record(response).payload);assignments.push(...rows(payload.items));const page=record(payload.page);cursor=page.hasMore===true?string(page.nextCursor):'';} while(cursor);
	return coordinatedWorkdayWatchPayload(run,assignments);
}

export type WorkdayWatchAction='waiting-for-assignment'|'executing'|'verify-and-integrate'|'waiting-for-terminalization'|'repair-failure'|'collect-proof';
export const CAPACITY_WORKDAY_WATCH_ACTIONS=new Set(['workday-watch']);

export function classifyWorkdayWatch(payload:Row):{action:WorkdayWatchAction;terminal:boolean;detail:string;assignmentIds:string[]} {
	const workday=record(payload.workday);const totals=record(payload.totals);const counts=record(totals.assignments);
	const evidence=record(payload.evidence);const assignments=rows(record(evidence.assignments).items);
	const failed=Number(counts.failed??0)+Number(counts.cancelled??0)+Number(counts.returned??0);
	if(failed>0)return {action:'repair-failure',terminal:true,detail:`${failed} assignment outcome(s) require repair.`,assignmentIds:assignments.filter((entry)=>['failed','cancelled','returned'].includes(string(entry.status))).map((entry)=>string(entry.id)).filter(Boolean)};
	const status=string(workday.status);
	if(['completed','failed','degraded','cancelled'].includes(status))return {action:status==='completed'?'collect-proof':'repair-failure',terminal:true,detail:`Workday is ${status}.`,assignmentIds:assignments.map((entry)=>string(entry.id)).filter(Boolean)};
	const unpublished=assignments.filter((entry)=>string(entry.status)==='completed'&&Number(record(entry.cleanup).unpublishedBranches??0)>0);
	if(unpublished.length)return {action:'verify-and-integrate',terminal:true,detail:`${unpublished.length} completed assignment(s) have exact unpublished repository outcomes.`,assignmentIds:unpublished.map((entry)=>string(entry.id)).filter(Boolean)};
	const completed=Number(counts.completed??0);const total=Number(counts.total??0);
	if(total>0&&completed===total)return {action:'waiting-for-terminalization',terminal:false,detail:'All assignments are integrated; the admission fence and parent terminalization remain.',assignmentIds:assignments.map((entry)=>string(entry.id)).filter(Boolean)};
	if(Number(counts.leased??0)>0)return {action:'executing',terminal:false,detail:`${counts.leased} assignment(s) are executing.`,assignmentIds:assignments.filter((entry)=>string(entry.status)==='leased').map((entry)=>string(entry.id)).filter(Boolean)};
	return {action:'waiting-for-assignment',terminal:false,detail:'No assignment is currently executing.',assignmentIds:[]};
}

async function journal(context:CommandContext,generation:string,entry:Row) {
	const root=resolve(context.cwd,'.treeseed/guarantees/campaigns',generation);await mkdir(root,{recursive:true});
	await appendFile(resolve(root,'journal.jsonl'),`${JSON.stringify({schemaVersion:'treeseed.agent-guarantee-campaign-event/v1',observedAt:new Date().toISOString(),...entry})}\n`,{mode:0o600});
}

export async function runCapacityWorkdayWatch(invocation:ParsedInvocation,context:CommandContext) {
	const workdayId=text(invocation,'workday');if(!workdayId)return fail('Capacity workday-watch requires exact --workday.');
	const catalog=createAgentGuaranteeCatalogStatus({workspaceRoot:context.cwd,catalog:'agent.system'});const generation=catalog.generation;
	const expected=text(invocation,'generation');if(expected&&expected!==generation)return fail(`Guarantee generation changed: expected ${expected}, observed ${generation}.`);
	const timeoutSeconds=Math.min(3600,Math.max(1,numberArg(invocation,'timeoutSeconds')??900));
	const pollMs=Math.min(10_000,Math.max(250,numberArg(invocation,'pollIntervalMs')??2_000));
	const {client}=createMarketClientForInvocation(invocation,context,{requireAuth:true,allowLocalAcceptanceAdmin:true});
	const teamSelector=text(invocation,'team');const teamId=teamSelector?(await resolveCapacityTeam(client,teamSelector)).teamId:'';
	const deadline=Date.now()+timeoutSeconds*1000;let prior='';let latest:Row={};let classification=classifyWorkdayWatch(latest);
	while(Date.now()<deadline) {
		if(teamId)latest=await readCoordinatedWorkday(client,teamId,workdayId);
		else {const response=await client.workdaySummary(workdayId,{evidence:'assignments',limit:200,cursor:null});latest=record(response.payload);}
		classification=classifyWorkdayWatch(latest);
		if(classification.action!==prior) {
			prior=classification.action;await Promise.resolve(context.write(`[workday-watch] ${classification.action}: ${classification.detail}\n`,'stderr'));
			await journal(context,generation,{type:'workday-transition',workdayId,...classification});
		}
		if(classification.terminal)break;
		await new Promise((done)=>setTimeout(done,pollMs));
	}
	const timedOut=!classification.terminal&&Date.now()>=deadline;
	await journal(context,generation,{type:'workday-watch-complete',workdayId,...classification,timedOut});
	const command=invocation.commandName==='guarantees'?'guarantees watch':'capacity workday-watch';
	return {exitCode:timedOut?1:0,stdout:[timedOut?'Workday watch reached its bounded deadline.':`Next action: ${classification.action}.`],stderr:[],report:{command,ok:!timedOut,generation,workdayId,nextAction:classification.action,assignmentIds:classification.assignmentIds,detail:classification.detail,timedOut,summary:{workday:latest.workday,totals:latest.totals,settlement:latest.settlement}}};
}
