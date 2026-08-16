import { randomUUID } from 'node:crypto';
import type { CommandContext,ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail,guidedResult } from '../../utilities/utils.js';
import { capacityPositiveNumberArg,capacityStringArg as text } from '../capacity-core/capacity-command-arguments.js';
import { resolveCapacityTeam } from '../capacity-core/capacity-market-context.js';

export async function runCapacityContextQueryTest(invocation:ParsedInvocation,context:CommandContext) {
	const projectId=text(invocation,'project'); const teamSelector=text(invocation,'team'); const testId=text(invocation,'agentTest');
	if(!projectId) return fail('Missing --project for capacity context-query-test.');
	if(!teamSelector) return fail('Missing --team for capacity context-query-test.');
	if(!testId) return fail('Missing --agent-test for capacity context-query-test.');
	const {profile,client}=createMarketClientForInvocation(invocation,context,{requireAuth:true,allowLocalAcceptanceAdmin:true});
	const team=await resolveCapacityTeam(client,teamSelector);
	const idempotencyKey=text(invocation,'idempotencyKey')??`cli:context-query-check:${randomUUID()}`;
	const response=await client.checkProjectContextQuery(team.teamId,projectId,{
		testId,idempotencyKey,freshForSeconds:capacityPositiveNumberArg(invocation,'freshForSeconds',86_400),includeResult:invocation.args.includeResult===true,
	});
	const payload=response.payload; const passing=payload.status==='passing';
	return guidedResult({
		command:'capacity context-query-test',summary:`Context query test ${String(payload.testRef??testId)} is ${String(payload.status??'unknown')}.`,exitCode:passing?0:1,
		facts:[{label:'Market',value:`${profile.id} (${profile.baseUrl})`},{label:'Project',value:projectId},{label:'Definition ref',value:String((payload.definition as Record<string,unknown>|undefined)?.commit??'unknown')}],
		report:{action:'context-query-test',idempotencyKey,...payload},
	});
}

export async function runCapacityContextQueryChecks(invocation:ParsedInvocation,context:CommandContext) {
	const projectId=text(invocation,'project'); const teamSelector=text(invocation,'team');
	if(!projectId||!teamSelector) return fail('Capacity context-query-checks requires --team and --project.');
	const {profile,client}=createMarketClientForInvocation(invocation,context,{requireAuth:true,allowLocalAcceptanceAdmin:true});
	const team=await resolveCapacityTeam(client,teamSelector); const payload=(await client.projectContextQueryChecks(team.teamId,projectId)).payload;
	return guidedResult({command:'capacity context-query-checks',summary:`Observed ${payload.definitions.length} context definition(s) and ${payload.tests.length} isolated test(s); ${payload.selectableDefinitions.length} definitions have all required tests passing.`,
		facts:[{label:'Market',value:`${profile.id} (${profile.baseUrl})`},{label:'Definition ref',value:payload.definitionCommit}],report:{action:'context-query-checks',projectId,...payload}});
}
