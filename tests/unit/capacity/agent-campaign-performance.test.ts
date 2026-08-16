import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { rebaseAgentProof } from '../../../src/cli/handlers/guarantees/agent-campaign.ts';
import { classifyWorkdayWatch,coordinatedWorkdayWatchPayload } from '../../../src/cli/handlers/capacity/workdays/observability/capacity-workday-watch.ts';
import { campaignEvidenceReport,requiredCampaignCommands } from '../../../src/cli/handlers/guarantees/agent-campaign-runner.ts';
import { providerPin } from '../../../src/cli/handlers/guarantees/agent-guarantee-preflight.ts';

describe('agent guarantee campaign helpers',()=>{
	it('rebases exact assignment, workday, generation, variant, and semantically verified artifact path',()=>{
		const proof=rebaseAgentProof({variant:'baseline',sourceGeneration:'a'.repeat(64),commands:[{id:'assignment',args:['capacity','assignment','--assignment','old-assignment','--workday','old-workday']}],outcomes:[{predicates:[{id:'planning.path',expected:'src/content/notes/old.mdx'},{id:'planning.assignment',expected:'old-assignment'}]}]}, {variant:'clean-repeat',generation:'b'.repeat(64),assignmentId:'new-assignment',workdayId:'new-workday',artifactPath:'src/content/notes/new.mdx'});
		assert.equal(proof.variant,'clean-repeat');assert.equal(proof.sourceGeneration,'b'.repeat(64));
		assert.deepEqual((proof.commands as any[])[0].args,['capacity','assignment','--assignment','new-assignment','--workday','new-workday']);
		assert.equal((proof.outcomes as any[])[0].predicates[0].expected,'src/content/notes/new.mdx');
		assert.equal((proof.outcomes as any[])[0].predicates[1].expected,'new-assignment');
	});

	it('stops immediately for semantic review when a completed assignment retains an unpublished branch',()=>{
		const state=classifyWorkdayWatch({workday:{status:'active'},totals:{assignments:{total:1,completed:1,failed:0,cancelled:0,returned:0}},evidence:{assignments:{items:[{status:'completed',cleanup:{unpublishedBranches:1}}]}}});
		assert.deepEqual(state,{action:'verify-and-integrate',terminal:true,detail:'1 completed assignment(s) have exact unpublished repository outcomes.',assignmentIds:[]});
	});

	it('never recommends proof collection for a failed parent',()=>{
		assert.equal(classifyWorkdayWatch({workday:{status:'failed'},totals:{assignments:{failed:0}}}).action,'repair-failure');
	});

	it('normalizes an exact coordinated run and stops for unpublished assignment artifacts',()=>{
		const payload=coordinatedWorkdayWatchPayload({id:'run-a',status:'running'},[{id:'assignment-a',status:'completed',lifecycleOutput:{artifactManifest:{contentReferences:[{contentPath:'src/content/notes/a.mdx'}]}},contentIntegrations:[]}]);
		assert.deepEqual(classifyWorkdayWatch(payload),{action:'verify-and-integrate',terminal:true,detail:'1 completed assignment(s) have exact unpublished repository outcomes.',assignmentIds:['assignment-a']});
	});

	it('requires every campaign variant to watch, verify, fence admission, and capture proof',()=>{
		assert.deepEqual(requiredCampaignCommands({commands:[{args:['guarantees','watch']},{args:['capacity','assignment-artifacts-verify']},{args:['capacity','workday-close-admission']},{args:['guarantees','proof-capture']}]}),[]);
		assert.deepEqual(requiredCampaignCommands({commands:[{args:['guarantees','watch']}] }),['capacity assignment-artifacts-verify','capacity workday-close-admission','guarantees proof-capture']);
	});

	it('does not persist dynamic query results or repository artifact bodies in transcripts',()=>{
		assert.deepEqual(campaignEvidenceReport({ok:true,payload:{queryResults:[{id:'private'}],content:'draft',stats:{count:1}}}),{ok:true,payload:{queryResults:'[OMITTED_NON_EVIDENCE_PAYLOAD]',content:'[OMITTED_NON_EVIDENCE_PAYLOAD]',stats:{count:1}}});
	});

	it('pins the OCI source-closure label emitted by managed Docker reconciliation',()=>{
		assert.deepEqual(providerPin({availabilitySession:{id:'session-a'},Config:{Labels:{'org.treeseed.source-closure':'closure-a'}},imageId:'sha256:image-a',configHash:'config-a'}),{sessionIds:['session-a'],sourceClosureDigests:['closure-a'],imageIds:['sha256:image-a'],configHashes:['config-a']});
	});
});
