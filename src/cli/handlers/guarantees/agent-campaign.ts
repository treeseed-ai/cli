import { createAgentGuaranteeCatalogStatus,discoverGuarantees,parseAgentGuaranteeProofInput } from '@treeseed/sdk/guarantees';
import { appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { dirname,isAbsolute,relative,resolve } from 'node:path';
import type { CommandContext,ParsedInvocation } from '../../types.js';
import { createMarketClientForInvocation } from '../content/market-utils.js';
import { resolveCapacityTeam } from '../capacity/capacity-core/capacity-market-context.js';
import { inspectAssignmentArtifacts } from '../capacity/assignments/capacity-assignment-artifacts.js';

type Row=Record<string,unknown>;
const record=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const value=(invocation:ParsedInvocation,key:string)=>typeof invocation.args[key]==='string'?String(invocation.args[key]).trim():'';
function path(context:CommandContext,input:string){if(!input||isAbsolute(input))return null;const resolved=resolve(context.cwd,input);const traversal=relative(context.cwd,resolved);return traversal.startsWith('..')||isAbsolute(traversal)?null:resolved;}
function selected(context:CommandContext,id:string) {
	const registry=discoverGuarantees({workspaceRoot:context.cwd,filter:{ids:[id]}});const guarantee=registry.guarantees.find((entry)=>entry.manifest?.id===id)?.manifest;
	return registry.ok&&guarantee?.catalogContract?guarantee:null;
}
function selector(args:string[],flag:string){const index=args.indexOf(flag);return index>=0?args[index+1]??'':'';}
function replaceSelector(args:string[],flag:string,next:string){const copy=[...args];const index=copy.indexOf(flag);if(index>=0&&next)copy[index+1]=next;return copy;}
function journal(context:CommandContext,generation:string,entry:Row){const root=resolve(context.cwd,'.treeseed/guarantees/campaigns',generation);mkdirSync(root,{recursive:true});appendFileSync(resolve(root,'journal.jsonl'),`${JSON.stringify({schemaVersion:'treeseed.agent-guarantee-campaign-event/v1',observedAt:new Date().toISOString(),...entry})}\n`,{mode:0o600});}

export function rebaseAgentProof(input:Row,options:{variant:string;generation:string;assignmentId?:string;workdayId?:string;artifactPath?:string}) {
	const commands=(Array.isArray(input.commands)?input.commands:[]).map((entry)=>{
		const command=record(entry);let args=Array.isArray(command.args)?command.args.map(String):[];
		if(options.assignmentId)args=replaceSelector(args,'--assignment',options.assignmentId);
		if(options.workdayId)args=replaceSelector(args,'--workday',options.workdayId);
		return {...command,args};
	});
	const oldAssignments=new Set((Array.isArray(input.commands)?input.commands:[]).map(record).flatMap((entry)=>[selector(Array.isArray(entry.args)?entry.args.map(String):[],'--assignment')]).filter(Boolean));
	const oldWorkdays=new Set((Array.isArray(input.commands)?input.commands:[]).map(record).flatMap((entry)=>[selector(Array.isArray(entry.args)?entry.args.map(String):[],'--workday')]).filter(Boolean));
	const replaceExpected=(candidate:unknown,id=''):unknown=>{
		if(Array.isArray(candidate))return candidate.map((entry)=>replaceExpected(entry,id));
		if(candidate&&typeof candidate==='object')return Object.fromEntries(Object.entries(candidate as Row).map(([key,entry])=>[key,replaceExpected(entry,key==='expected'?String(record(candidate).id??''):id)]));
		if(typeof candidate!=='string')return candidate;
		if(options.artifactPath&&id.endsWith('.path')&&candidate.startsWith('src/content/'))return options.artifactPath;
		if(options.assignmentId&&oldAssignments.has(candidate))return options.assignmentId;
		if(options.workdayId&&oldWorkdays.has(candidate))return options.workdayId;
		return candidate;
	};
	return {...replaceExpected(input) as Row,variant:options.variant,sourceGeneration:options.generation,commands};
}

export function handleAgentProofRebase(invocation:ParsedInvocation,context:CommandContext) {
	const id=value(invocation,'id');const variant=value(invocation,'variant');const inputPath=path(context,value(invocation,'input'));const outputPath=path(context,value(invocation,'output'));
	if(!id||!variant||!inputPath||!outputPath)return {exitCode:1,stdout:[],stderr:['proof-rebase requires exact --id, --variant, workspace-relative --input, and --output.'],report:{command:'guarantees proof-rebase',ok:false}};
	if(!existsSync(inputPath))return {exitCode:1,stdout:[],stderr:['The proof recipe input does not exist.'],report:{command:'guarantees proof-rebase',ok:false}};
	const guarantee=selected(context,id);if(!guarantee)return {exitCode:1,stdout:[],stderr:['The selected v2 catalog guarantee is invalid.'],report:{command:'guarantees proof-rebase',ok:false}};
	const generation=createAgentGuaranteeCatalogStatus({workspaceRoot:context.cwd,catalog:'agent.system'}).generation;
	const parsed=JSON.parse(readFileSync(inputPath,'utf8')) as Row;const proof=rebaseAgentProof(parsed,{variant,generation,assignmentId:value(invocation,'assignment')||undefined,workdayId:value(invocation,'workday')||undefined,artifactPath:value(invocation,'artifactPath')||undefined});
	const validation=parseAgentGuaranteeProofInput(proof,guarantee.catalogContract!,variant,generation);
	if(!validation.ok)return {exitCode:1,stdout:[],stderr:validation.issues,report:{command:'guarantees proof-rebase',ok:false,issues:validation.issues}};
	mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,`${JSON.stringify(validation.proof,null,2)}\n`,{mode:0o600});
	journal(context,generation,{type:'proof-rebased',guaranteeId:id,variant,input:relative(context.cwd,inputPath),output:relative(context.cwd,outputPath)});
	return {exitCode:0,stdout:[`Rebased exact proof input: ${relative(context.cwd,outputPath)}`],stderr:[],report:{command:'guarantees proof-rebase',ok:true,generation,id,variant,path:relative(context.cwd,outputPath),proof:validation.proof}};
}

export async function handleAgentProofCapture(invocation:ParsedInvocation,context:CommandContext) {
	const id=value(invocation,'id');const variant=value(invocation,'variant');const inputPath=path(context,value(invocation,'input'));const outputPath=path(context,value(invocation,'output'));
	const assignmentId=value(invocation,'assignment');const team=value(invocation,'team');const agentTest=value(invocation,'agentTest');
	if(!id||!variant||!inputPath||!outputPath||!assignmentId||!team||!agentTest)return {exitCode:1,stdout:[],stderr:['proof-capture requires exact --id, --variant, --input, --output, --team, --assignment, and --agent-test.'],report:{command:'guarantees proof-capture',ok:false}};
	if(!existsSync(inputPath))return {exitCode:1,stdout:[],stderr:['The proof recipe input does not exist.'],report:{command:'guarantees proof-capture',ok:false}};
	const guarantee=selected(context,id);if(!guarantee)return {exitCode:1,stdout:[],stderr:['The selected v2 catalog guarantee is invalid.'],report:{command:'guarantees proof-capture',ok:false}};
	try {
		const {client}=createMarketClientForInvocation(invocation,context,{requireAuth:true,allowLocalAcceptanceAdmin:true});const {teamId}=await resolveCapacityTeam(client,team);
		const inspected=await inspectAssignmentArtifacts({client,teamId,assignmentId,agentTest});const assignment=record(inspected.assignment);
		if(String(assignment.status)!=='completed')throw new Error(`Assignment ${assignmentId} is ${String(assignment.status||'unknown')}; proof requires completed authoritative state.`);
		const cleanup=record(assignment.cleanup);const residue=['activeAssignments','activeLeases','activeReservations','activeDemands','activeWorkspaces','activeWorktrees','unpublishedBranches','staleAuthorities'].filter((key)=>Number(cleanup[key]??0)>0);if(cleanup.verified!==true||residue.length)throw new Error(`Assignment still has repository/capacity residue: ${residue.join(', ')||'cleanup read-back is unverified'}.`);
		const integrations=Array.isArray(assignment.contentIntegrations)?assignment.contentIntegrations.map(record):[];if(inspected.artifacts.length&&(!integrations.length||integrations.some((entry)=>entry.readBackVerified!==true)))throw new Error('Proof capture requires exact integrated content receipts with authoritative read-back.');
		const failed=inspected.assertions.filter((entry)=>!entry.passed);if(failed.length)throw new Error(`Semantic artifact preflight failed: ${failed.map((entry)=>entry.id).join(', ')}.`);
		const paths=[...new Set(inspected.assertions.flatMap((entry)=>entry.attempts.filter((attempt)=>Object.values(attempt.checks).every(Boolean)).map((attempt)=>attempt.path)))];
		if(paths.length!==1)throw new Error(`Proof capture requires one unambiguous passing artifact; observed ${paths.length}.`);
		const metadata=record(assignment.metadata);const workdayId=String(assignment.workDayId||metadata.workdayRunId||'');if(!workdayId)throw new Error('Assignment lacks exact workday provenance.');
		const generation=createAgentGuaranteeCatalogStatus({workspaceRoot:context.cwd,catalog:'agent.system'}).generation;
		const parsed=JSON.parse(readFileSync(inputPath,'utf8')) as Row;const proof=rebaseAgentProof(parsed,{variant,generation,assignmentId,workdayId,artifactPath:paths[0]});
		const validation=parseAgentGuaranteeProofInput(proof,guarantee.catalogContract!,variant,generation);if(!validation.ok)throw new Error(validation.issues.join('\n'));
		mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,`${JSON.stringify(validation.proof,null,2)}\n`,{mode:0o600});
		journal(context,generation,{type:'proof-captured',guaranteeId:id,variant,assignmentId,workdayId,artifactPath:paths[0],definitionRef:inspected.identity.definitionRef,output:relative(context.cwd,outputPath)});
		return {exitCode:0,stdout:[`Captured proof from authoritative assignment ${assignmentId}.`],stderr:[],report:{command:'guarantees proof-capture',ok:true,generation,id,variant,path:relative(context.cwd,outputPath),assignmentId,workdayId,artifactPath:paths[0],definitionRef:inspected.identity.definitionRef}};
	}catch(error){return {exitCode:1,stdout:[],stderr:[error instanceof Error?error.message:String(error)],report:{command:'guarantees proof-capture',ok:false,assignmentId}};}
}

export function handleAgentCampaignStatus(context:CommandContext) {
	const catalog=createAgentGuaranteeCatalogStatus({workspaceRoot:context.cwd,catalog:'agent.system'});const next=catalog.entries.find((entry)=>entry.state!=='active');
	const nextVariant=next?.missingVariants?.[0]??null;const journalPath=resolve(context.cwd,'.treeseed/guarantees/campaigns',catalog.generation,'journal.jsonl');
	return {exitCode:catalog.ok?0:1,stdout:[next?`Next: ${next.capabilityId} / ${nextVariant??'resolve blockers'}.`:'All canonical agent guarantees are active.'],stderr:[],report:{command:'guarantees campaign-status',ok:catalog.ok,generation:catalog.generation,counts:catalog.counts,next:next?{id:next.id,capabilityId:next.capabilityId,state:next.state,passingStreak:next.passingStreak,variant:nextVariant,blockedBy:next.blockedBy}:null,journal:relative(context.cwd,journalPath)}};
}
