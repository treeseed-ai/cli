import { randomUUID } from 'node:crypto';
import type { CommandContext,ParsedInvocation } from '../../../../types.js';
import { createMarketClientForInvocation } from '../../../content/market-utils.js';
import { fail,guidedResult } from '../../../utilities/utils.js';
import { resolveCapacityTeam } from '../capacity-market-context.js';

export const CAPACITY_CONTENT_INTEGRATION_ACTIONS=new Set(['content-abandon','content-integrate']);
function text(invocation:ParsedInvocation,name:string){const value=invocation.args[name];return typeof value==='string'&&value.trim()?value.trim():'';}
function csv(invocation:ParsedInvocation,name:string){return text(invocation,name).split(',').map((value)=>value.trim()).filter(Boolean);}

export async function runCapacityContentIntegration(action:string,invocation:ParsedInvocation,context:CommandContext){
	const plan=invocation.args.plan===true; const execute=invocation.args.execute===true;
	if(plan===execute)return fail(`Capacity ${action} is mutating. Choose exactly one of --plan or --execute.`);
	const assignmentId=text(invocation,'assignment'); const teamSelector=text(invocation,'team');
	const expectedBaseRef=text(invocation,'expectedBase'); const expectedCommitSha=text(invocation,'expectedCommit');
	const reason=text(invocation,'reason'); const workdayId=text(invocation,'workday');
	const expectedCommitShas=csv(invocation,'expectedCommits');
	if(action==='content-abandon'){
		if(!teamSelector||!assignmentId||!expectedCommitShas.length)return fail('content-abandon requires --team, --assignment, and --expected-commits.');
		if(invocation.args.simulateHuman!==true||!reason||!workdayId)return fail('content-abandon requires --simulate-human, --workday, and an evidence-based --reason.');
		if(execute&&invocation.args.yes!==true)return fail('Live content abandonment is binding and requires --yes.');
		const {profile,client}=createMarketClientForInvocation(invocation,context,{requireAuth:true,allowLocalAcceptanceAdmin:true});const {teamId}=await resolveCapacityTeam(client,teamSelector);
		const request={idempotencyKey:text(invocation,'idempotencyKey')||`cli:content-abandon:${randomUUID()}`,expectedCommitShas,reason,workdayId,simulateHuman:true as const};
		if(plan)return guidedResult({command:'capacity content-abandon',summary:'Assignment content abandonment plan rendered without mutation.',facts:[{label:'Market',value:`${profile.id} (${profile.baseUrl})`},{label:'Team',value:teamId},{label:'Assignment',value:assignmentId}],report:{action,mode:'plan',request}});
		const response=await client.abandonAssignmentContent(teamId,assignmentId,request);return guidedResult({command:'capacity content-abandon',summary:'Abandoned exact unpublished assignment content and verified ref and journal cleanup.',facts:[{label:'Assignment',value:assignmentId},{label:'Ref',value:response.payload.ref},{label:'Commits',value:response.payload.abandonedCommitShas.length},{label:'Replay',value:response.payload.replayed?'yes':'no'}],report:{action,mode:'live',payload:response.payload}});
	}
	if(!teamSelector||!assignmentId||!expectedBaseRef||!expectedCommitSha)return fail('content-integrate requires --team, --assignment, --expected-base, and --expected-commit.');
	if(invocation.args.simulateHuman!==true||!reason||!workdayId)return fail('content-integrate requires --simulate-human, --workday, and an evidence-based --reason.');
	if(execute&&invocation.args.yes!==true)return fail('Live content integration is binding and requires --yes.');
	const { profile,client }=createMarketClientForInvocation(invocation,context,{ requireAuth:true,allowLocalAcceptanceAdmin:true });
	const { teamId }=await resolveCapacityTeam(client,teamSelector);
	const request={ idempotencyKey:text(invocation,'idempotencyKey')||`cli:content-integrate:${randomUUID()}`,expectedBaseRef,expectedCommitSha,reason,workdayId,simulateHuman:true as const };
	if(plan)return guidedResult({ command:'capacity content-integrate',summary:'Assignment content integration plan rendered without mutation.',
		facts:[{label:'Market',value:`${profile.id} (${profile.baseUrl})`},{label:'Team',value:teamId},{label:'Assignment',value:assignmentId}],report:{ action:'content-integrate',mode:'plan',request } });
	const response=await client.integrateAssignmentContent(teamId,assignmentId,request);
	return guidedResult({ command:'capacity content-integrate',summary:'Integrated the exact reviewed assignment content checkpoint and verified target-ref read-back.',
		facts:[{label:'Assignment',value:assignmentId},{label:'Target ref',value:response.payload.receipt.integration?.targetRef},{label:'Commit',value:response.payload.receipt.effectiveRef},{label:'Replay',value:response.payload.replayed?'yes':'no'}],
		report:{ action:'content-integrate',mode:'live',payload:response.payload } });
}
