import { randomUUID } from 'node:crypto';
import type { CommandContext,ParsedInvocation } from '../../../../types.js';
import { createMarketClientForInvocation } from '../../../content/market-utils.js';
import { fail,guidedResult } from '../../../utilities/utils.js';
import { resolveCapacityTeam } from '../capacity-market-context.js';

export const CAPACITY_DISCUSSION_ACTIONS=new Set(['discussion-read','discussion-send','agent-invocations','agent-invocation','agent-invocation-cancel','communication-status','operation-handoffs','client-actions']);
function text(invocation:ParsedInvocation,name:string){const value=invocation.args[name];return typeof value==='string'&&value.trim()?value.trim():'';}

export async function runCapacityDiscussion(action:string,invocation:ParsedInvocation,context:CommandContext){
	const { profile,client }=createMarketClientForInvocation(invocation,context,{ requireAuth:true,allowLocalAcceptanceAdmin:true });
	if(['communication-status','operation-handoffs','client-actions'].includes(action)){
		const teamSelector=text(invocation,'team');if(!teamSelector)return fail(`${action} requires --team.`);const {teamId}=await resolveCapacityTeam(client,teamSelector);const params=new URLSearchParams();for(const name of ['status','limit']){const value=text(invocation,name);if(value)params.set(name,value);}const response=await client.request<{payload:unknown}>(`/v1/teams/${encodeURIComponent(teamId)}/${action}?${params}`,{requireAuth:true});return guidedResult({command:`capacity ${action}`,summary:`Inspected ${action.replaceAll('-',' ')}.`,facts:[{label:'Team',value:teamId}],report:{action,mode:'read',payload:response.payload}});
	}
	if(action.startsWith('agent-invocation')){
		const teamSelector=text(invocation,'team');if(!teamSelector)return fail(`${action} requires --team.`);const {teamId}=await resolveCapacityTeam(client,teamSelector);const invocationId=text(invocation,'invocation');
		if(action==='agent-invocations'){
			const params=new URLSearchParams();for(const name of ['status','executionKind','limit']){const value=text(invocation,name);if(value)params.set(name,value);}const response=await client.request<{payload:unknown}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-invocations?${params}`,{requireAuth:true});return guidedResult({command:`capacity ${action}`,summary:'Inspected canonical agent invocation admission state.',facts:[{label:'Team',value:teamId}],report:{action,mode:'read',payload:response.payload}});
		}
		if(!invocationId)return fail(`${action} requires --invocation.`);
		if(action==='agent-invocation'){const response=await client.request<{payload:unknown}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-invocations/${encodeURIComponent(invocationId)}`,{requireAuth:true});return guidedResult({command:`capacity ${action}`,summary:'Inspected one canonical agent invocation.',facts:[{label:'Team',value:teamId},{label:'Invocation',value:invocationId}],report:{action,mode:'read',payload:response.payload}});}
		const plan=invocation.args.plan===true;const execute=invocation.args.execute===true;if(plan===execute)return fail('agent-invocation-cancel is mutating. Choose exactly one of --plan or --execute.');const request={idempotencyKey:text(invocation,'idempotencyKey')||`cli:agent-invocation-cancel:${randomUUID()}`,reason:text(invocation,'reason')||'Operator cancelled queued communication invocation.'};if(plan)return guidedResult({command:`capacity ${action}`,summary:'Invocation cancellation plan rendered without mutation.',facts:[{label:'Team',value:teamId},{label:'Invocation',value:invocationId}],report:{action,mode:'plan',request}});const response=await client.request<{payload:unknown;reconciled?:boolean}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-invocations/${encodeURIComponent(invocationId)}/cancel`,{method:'POST',body:request,requireAuth:true,headers:{'Idempotency-Key':request.idempotencyKey}});return guidedResult({command:`capacity ${action}`,summary:response.reconciled?'Reconciled the invocation to its exact terminal assignment outcome.':'Cancelled the unadmitted invocation.',facts:[{label:'Team',value:teamId},{label:'Invocation',value:invocationId}],report:{action,mode:'live',payload:response.payload}});
	}
	const projectId=text(invocation,'project'); if(!projectId)return fail(`${action} requires --project.`);
	if(action==='discussion-read'){
		const collection=text(invocation,'collection');
		if(collection&&!['discussions','messages','events'].includes(collection))return fail('--collection must be discussions, messages, or events.');
		const payload=await client.discussions(projectId,{ discussionId:text(invocation,'discussion')||undefined,
			query:text(invocation,'query')||undefined,
			collection:collection ? collection as 'discussions'|'messages'|'events' : undefined,
			limit:Number(text(invocation,'limit'))||undefined,after:text(invocation,'cursor')||undefined });
		return guidedResult({ command:'capacity discussion-read',summary:'Read authoritative TreeDX discussion state.',facts:[{label:'Market',value:`${profile.id} (${profile.baseUrl})`},{label:'Project',value:projectId}],report:{ action,mode:'read',payload:payload.payload } });
	}
	const plan=invocation.args.plan===true; const execute=invocation.args.execute===true;
	if(plan===execute)return fail('Capacity discussion-send is mutating. Choose exactly one of --plan or --execute.');
	const teamSelector=text(invocation,'team'); const message=text(invocation,'message'); const workdayId=text(invocation,'workday'); const reason=text(invocation,'reason');
	if(!teamSelector||!message)return fail('discussion-send requires --team, --project, and --message.');
	const simulatedHuman=invocation.args.simulateHuman===true;
	if(simulatedHuman&&(!workdayId||!reason))return fail('Simulated-human discussion requires --workday and an evidence-based --reason.');
	const { teamId }=await resolveCapacityTeam(client,teamSelector); const selectedIntent=text(invocation,'intent');
	if(selectedIntent&&!['discuss','propose'].includes(selectedIntent))return fail('--intent must be discuss or propose. Operation work requires an approval-backed operation handoff.');
	const request={ teamId,projectId,idempotencyKey:text(invocation,'idempotencyKey')||`cli:discussion-send:${randomUUID()}`,body:message,
		discussionId:text(invocation,'discussion')||undefined,topic:text(invocation,'topic')||undefined,
		intent:(selectedIntent||'discuss') as 'discuss'|'propose',
		parentWorkdayId:text(invocation,'parentWorkday')||undefined,
		parentAssignmentId:text(invocation,'parentAssignment')||undefined,
		...(simulatedHuman?{simulateHuman:true as const,workdayId,reason}:{}) };
	if(plan)return guidedResult({ command:'capacity discussion-send',summary:'Discussion message plan rendered without mutation.',facts:[{label:'Market',value:`${profile.id} (${profile.baseUrl})`},{label:'Team',value:teamId},{label:'Project',value:projectId}],report:{action,mode:'plan',request} });
	const response=await client.createDiscussionMessage(request);
	return guidedResult({ command:'capacity discussion-send',summary:'Committed the authenticated human discussion message through TreeDX.',facts:[{label:'Team',value:teamId},{label:'Project',value:projectId}],report:{action,mode:'live',payload:response} });
}
