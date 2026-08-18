import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { dirname,isAbsolute,relative,resolve } from 'node:path';
import { createAgentGuaranteeProofTemplate,discoverGuarantees,parseAgentGuaranteeProofInput } from '@treeseed/sdk/guarantees';
import type { CommandContext,ParsedInvocation } from '../../types.js';

function selected(invocation:ParsedInvocation,context:CommandContext) {
	const id=typeof invocation.args.id==='string'?invocation.args.id.trim():'';
	if(!id) return {error:'This action requires one exact --id.'} as const;
	const registry=discoverGuarantees({workspaceRoot:context.cwd,filter:{ids:[id]}});
	const guarantee=registry.guarantees.find((entry)=>entry.manifest?.id===id);
	if(!registry.ok||!guarantee?.manifest?.catalogContract) return {error:`${id} is not one valid v2 catalog guarantee.`} as const;
	return {guarantee:guarantee.manifest} as const;
}

function workspacePath(context:CommandContext,value:unknown) {
	const configured=typeof value==='string'?value.trim():'';
	if(!configured||isAbsolute(configured)) return null;
	const path=resolve(context.cwd,configured); const traversal=relative(context.cwd,path);
	return traversal.startsWith('..')||isAbsolute(traversal)?null:path;
}

export function handleAgentProofInput(action:string,invocation:ParsedInvocation,context:CommandContext) {
	const selection=selected(invocation,context);
	if('error' in selection) return {exitCode:1,stdout:[],stderr:[selection.error],report:{command:`guarantees ${action}`,ok:false,error:'guarantee_selection_invalid'}};
	const variant=typeof invocation.args.variant==='string'?invocation.args.variant:'';
	if(!selection.guarantee.catalogContract!.activation.requiredVariants.includes(variant)) return {exitCode:1,stdout:[],stderr:['Select an admitted --variant.'],report:{command:`guarantees ${action}`,ok:false,error:'guarantee_variant_required'}};
	const path=workspacePath(context,action==='proof-template'?invocation.args.output:invocation.args.proofInput);
	if(!path) return {exitCode:1,stdout:[],stderr:[action==='proof-template'?'Use a workspace-relative --output.':'Use a workspace-relative --proof-input.'],report:{command:`guarantees ${action}`,ok:false,error:'guarantee_proof_path_invalid'}};
	if(action==='proof-template') {
		const template=createAgentGuaranteeProofTemplate({contract:selection.guarantee.catalogContract!,variant});
		mkdirSync(dirname(path),{recursive:true}); writeFileSync(path,`${JSON.stringify(template,null,2)}\n`);
		return {exitCode:0,stdout:[`Agent guarantee proof template written: ${relative(context.cwd,path)}`],stderr:[],report:{command:'guarantees proof-template',ok:true,id:selection.guarantee.id,capabilityId:selection.guarantee.catalogContract!.capabilityId,variant,path:relative(context.cwd,path),ready:false,requiredCommands:selection.guarantee.catalogContract!.proof.requiredCommands,outcomePredicates:selection.guarantee.catalogContract!.proof.outcomePredicates}};
	}
	if(!existsSync(path)) return {exitCode:1,stdout:[],stderr:[`Proof input does not exist: ${relative(context.cwd,path)}`],report:{command:'guarantees proof-validate',ok:false,error:'guarantee_proof_input_missing'}};
	let value:unknown; try { value=JSON.parse(readFileSync(path,'utf8')); } catch(error) { return {exitCode:1,stdout:[],stderr:['Proof input is not valid JSON.'],report:{command:'guarantees proof-validate',ok:false,error:'guarantee_proof_input_invalid_json',diagnostic:error instanceof Error?error.message:String(error)}}; }
	const validation=parseAgentGuaranteeProofInput(value,selection.guarantee.catalogContract!,variant);
	return {exitCode:validation.ok?0:1,stdout:validation.ok?['Agent guarantee proof input is structurally ready for live execution.']:[],stderr:validation.ok?[]:validation.issues,report:{command:'guarantees proof-validate',ok:validation.ok,id:selection.guarantee.id,capabilityId:selection.guarantee.catalogContract!.capabilityId,variant,path:relative(context.cwd,path),...(validation.ok?{proof:validation.proof}:{issues:validation.issues})}};
}
