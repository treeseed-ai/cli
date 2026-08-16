import { agentLabArtifactChecks,agentLabArtifactExpectations,type AgentLabArtifactExpectation } from '@treeseed/sdk/scenes';
import type { CommandContext,ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail,guidedResult } from '../../utilities/utils.js';
import { capacityStringArg as text } from '../capacity-core/capacity-command-arguments.js';
import { resolveCapacityTeam } from '../capacity-core/capacity-market-context.js';
import { capacityAuthenticatedMarketRequest as request } from '../capacity-core/capacity-values.js';

type Row=Record<string,unknown>;
const record=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const string=(value:unknown)=>typeof value==='string'?value.trim():'';
const rows=(value:unknown)=>Array.isArray(value)?value.map(record):[];

export function assignmentArtifactIdentity(assignment:Row) {
	const decision=record(assignment.decisionInput);const input=record(decision.input);
	const manifest=record(record(assignment.lifecycleOutput).artifactManifest);
	const refs=rows(manifest.contentReferences).filter((entry)=>string(entry.contentPath)&&string(entry.ref||entry.commitSha));
	return {
		projectId:string(assignment.projectId),repositoryId:string(input.repositoryId),
		definitionRef:string(input.contentBaseRef||record(record(assignment.metadata).configurationRevisions).agentDefinitionRevision),
		agentId:string(assignment.agentId),activityType:string(record(assignment.metadata).activityType||assignment.mode),refs,
	};
}

export async function readAssignmentArtifactFiles(client:any,projectId:string,repositoryId:string,refs:Row[]) {
	return Promise.all(refs.map(async(reference)=>{
		const path=string(reference.contentPath);const ref=string(reference.ref||reference.commitSha);
		const response=await client.treeDxReadRepositoryFiles(projectId,repositoryId,{ref,paths:[path],encoding:'utf8',parseFrontmatter:true});
		const file=rows(record(response.payload).files).find((entry)=>string(entry.path)===path)??{};
		return {...reference,...file,content:string(file.content||file.text)};
	}));
}

export function evaluateAssignmentArtifacts(artifacts:Row[],expectations:AgentLabArtifactExpectation[]) {
	return expectations.map((expectation)=>{
		const candidates=artifacts.filter((artifact)=>string(artifact.model)===expectation.model||string(artifact.contentPath||artifact.path).startsWith(expectation.pathPrefix));
		const attempts=candidates.map((artifact)=>({path:string(artifact.contentPath||artifact.path),checks:agentLabArtifactChecks(artifact,expectation)}));
		return {id:expectation.id,model:expectation.model,pathPrefix:expectation.pathPrefix,passed:attempts.some((attempt)=>Object.values(attempt.checks).every(Boolean)),attempts};
	});
}

export async function inspectAssignmentArtifacts(input:{client:any;teamId:string;assignmentId:string;agentTest?:string}) {
	const response=await request<{ok:boolean;payload:unknown}>(input.client,`/v1/teams/${encodeURIComponent(input.teamId)}/capacity/assignments/${encodeURIComponent(input.assignmentId)}`);
	const assignment=record(response.payload);const identity=assignmentArtifactIdentity(assignment);
	if(!identity.projectId||!identity.repositoryId)throw new Error('Assignment does not expose its exact project and TreeDX repository identity.');
	const artifacts=await readAssignmentArtifactFiles(input.client,identity.projectId,identity.repositoryId,identity.refs);
	if(!input.agentTest)return {assignment,identity,artifacts,assertions:[] as ReturnType<typeof evaluateAssignmentArtifacts>};
	if(!identity.definitionRef)throw new Error('Assignment does not expose its immutable agent/test definition ref.');
	const testPath=`src/content/agent-tests/${input.agentTest}.mdx`;
	const testResponse=await input.client.treeDxReadRepositoryFiles(identity.projectId,identity.repositoryId,{ref:identity.definitionRef,paths:[testPath],encoding:'utf8',parseFrontmatter:true});
	const test=rows(record(testResponse.payload).files).find((entry)=>string(entry.path)===testPath);
	if(!test)throw new Error(`Agent test ${input.agentTest} was not found at immutable ref ${identity.definitionRef}.`);
	const expectations=agentLabArtifactExpectations([{frontmatter:record(test.frontmatter)}]).filter((entry)=>entry.agentId===identity.agentId&&entry.activityType===identity.activityType);
	if(!expectations.length)throw new Error(`Agent test ${input.agentTest} declares no semantic artifact for ${identity.agentId}:${identity.activityType}.`);
	return {assignment,identity,artifacts,assertions:evaluateAssignmentArtifacts(artifacts,expectations),test:{id:input.agentTest,path:testPath,ref:identity.definitionRef}};
}

export const CAPACITY_ASSIGNMENT_ARTIFACT_ACTIONS=new Set(['assignment-artifacts','assignment-artifacts-verify']);

export async function runCapacityAssignmentArtifacts(action:string,invocation:ParsedInvocation,context:CommandContext) {
	const teamSelector=text(invocation,'team');const assignmentId=text(invocation,'assignment');
	if(!teamSelector||!assignmentId)return fail(`Capacity ${action} requires exact --team and --assignment selectors.`);
	const {profile,client}=createMarketClientForInvocation(invocation,context,{requireAuth:true,allowLocalAcceptanceAdmin:true});
	const {teamId}=await resolveCapacityTeam(client,teamSelector);
	let inspected:Awaited<ReturnType<typeof inspectAssignmentArtifacts>>;
	try{inspected=await inspectAssignmentArtifacts({client,teamId,assignmentId,agentTest:action==='assignment-artifacts-verify'?text(invocation,'agentTest'):undefined});}catch(error){return fail(error instanceof Error?error.message:String(error));}
	const {assignment,identity,artifacts}=inspected;
	if(action==='assignment-artifacts')return guidedResult({command:`capacity ${action}`,summary:`Read ${artifacts.length} exact assignment artifacts through TreeDX.`,facts:[{label:'Market',value:`${profile.id} (${profile.baseUrl})`},{label:'Assignment',value:assignmentId},{label:'Artifacts',value:artifacts.length}],report:{action,assignmentId,identity,artifacts}});
	if(!text(invocation,'agentTest'))return fail('Capacity assignment-artifacts-verify requires --agent-test <id>.');
	const ok=inspected.assertions.every((entry)=>entry.passed);
	return {exitCode:ok?0:1,stdout:[ok?'Exact assignment artifacts passed semantic verification.':'Exact assignment artifacts failed semantic verification.'],stderr:[],report:{command:`capacity ${action}`,ok,action,assignmentId,identity,test:inspected.test,assertions:inspected.assertions,artifacts}};
}
