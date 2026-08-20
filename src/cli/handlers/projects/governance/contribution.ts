import { validateProjectContributionAuthorization } from '@treeseed/sdk/work-providers';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CommandHandler,ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail,guidedResult } from '../../utilities/utils.js';

const text=(invocation:ParsedInvocation,name:string)=>typeof invocation.args[name]==='string'&&String(invocation.args[name]).trim()?String(invocation.args[name]).trim():null;
const payload=(value:any)=>value?.payload??value;
async function document(invocation:ParsedInvocation,cwd:string){const inline=text(invocation,'document');const file=text(invocation,'file');if(inline&&file)throw new Error('Use only one of --file or --document.');if(!inline&&!file)return{};const value=parseYaml(inline??await readFile(resolve(cwd,file!),'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Contribution input must be an object.');return value;}

export const handleContribution:CommandHandler=async(invocation,context)=>{
	const action=invocation.positionals[0];const projectId=text(invocation,'project');if(!action||!projectId)return fail('Use `trsd contribution <plan|apply|show|revoke|project|diagnose> --project <project-id>`.');
	let market;try{market=createMarketClientForInvocation(invocation,context,{requireAuth:true,allowLocalAcceptanceAdmin:false});}catch(error){return fail(error instanceof Error?error.message:String(error));}
	const request=(path:string,options:Record<string,unknown>={})=>market.client.request(path,{...options,requireAuth:true});const root=`/v1/projects/${encodeURIComponent(projectId)}/contribution-authorizations`;
	try{
		let result:any;
		if(action==='show')result=payload(await request(root));
		else if(action==='plan')result=payload(await request(`${root}/plan`,{method:'POST',body:await document(invocation,context.cwd)}));
		else if(action==='apply'){if(invocation.args.yes!==true)return fail('Applying standing contribution authorization requires --yes after reviewing the exact plan digest.');result=payload(await request(`${root}/apply`,{method:'POST',body:await document(invocation,context.cwd)}));}
		else if(action==='revoke'){const id=text(invocation,'authorization');if(!id||invocation.args.yes!==true)return fail('Revocation requires --authorization and --yes.');result=payload(await request(`${root}/${encodeURIComponent(id)}/revoke`,{method:'POST',body:{}}));}
		else if(action==='diagnose'){const listed=payload(await request(root));const authorization=Array.isArray(listed.items)?listed.items.find((item:any)=>item.status==='active'):null;const diagnostics=authorization?validateProjectContributionAuthorization(authorization).diagnostics:[{code:'contribution_authorization_missing',path:'authorization',message:'No active project authorization.'}];const agent=text(invocation,'agent');const provider=text(invocation,'provider');const branch=text(invocation,'branch');if(authorization&&agent&&!authorization.agentIds.includes(agent))diagnostics.push({code:'contribution_agent_unauthorized',path:'agent',message:'Agent is outside the standing grant.'});if(authorization&&provider&&!authorization.capacityProviderIds.includes(provider))diagnostics.push({code:'contribution_provider_unauthorized',path:'provider',message:'Provider is outside the standing grant.'});if(authorization&&branch&&!authorization.targetBranches.includes(branch))diagnostics.push({code:'contribution_branch_unauthorized',path:'branch',message:'Branch is outside the standing grant.'});result={ok:diagnostics.length===0,authorization,diagnostics};}
		else if(action==='project'){if(invocation.args.yes!==true)return fail('Projecting a trusted base policy requires --yes.');const listed=payload(await request(root));const authorization=Array.isArray(listed.items)?listed.items.find((item:any)=>item.status==='active'):null;if(!authorization)return fail('No active project contribution authorization can be projected.');const output=resolve(context.cwd,text(invocation,'output')??'.treeseed/contribution-policy.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,`${JSON.stringify({schemaVersion:'treeseed.contribution-policy/v1',projectId,repository:authorization.repository,activeAuthorization:authorization},null,2)}\n`,{encoding:'utf8',mode:0o644});result={output,authorizationId:authorization.id,generation:authorization.generation};}
		else return fail(`Unknown contribution action ${action}.`);
		return guidedResult({command:`contribution ${action}`,summary:`Contribution ${action} completed for project ${projectId}.`,facts:[{label:'Project',value:projectId},{label:'Authorization',value:String(result.authorization?.id??result.authorizationId??result.id??'none')},{label:'Status',value:String(result.authorization?.status??result.status??(result.ok===false?'blocked':'available'))}],report:{marketId:market.profile.id,action,projectId,result}});
	}catch(error){return fail(error instanceof Error?error.message:String(error));}
};
