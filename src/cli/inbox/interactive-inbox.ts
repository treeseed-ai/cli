import { controlPlaneOperation } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient } from '../support/client.js';
import { launchInkInbox } from './interactive-inbox-app.js';

type Row=Record<string,unknown>;
export async function runInteractiveInbox(invocation:ParsedInvocation,context:CommandContext,teamId:string){
	if(!context.interactiveUi||!process.stdin.isTTY||!process.stdout.isTTY)throw Object.assign(new Error('trsd inbox requires an interactive TTY.'),{category:'invalid_input',code:'inbox_tty_required'});
	if(invocation.options.json)throw Object.assign(new Error('trsd inbox is a full-screen interface and cannot emit JSON.'),{category:'invalid_input',code:'inbox_json_invalid'});
	let {client}=await createControlPlaneClient(invocation,context,true);const abort=new AbortController();
	const invoke=async(id:string,input:{path:Row;query:Row;body:unknown},options:Row={})=>{
		try{return await client.invoke(controlPlaneOperation(id),input,{...options,signal:abort.signal});}
		catch(error){if(Number((error as Row)?.status)!==401)throw error;({client}=await createControlPlaneClient(invocation,context,true,true));return client.invoke(controlPlaneOperation(id),input,{...options,signal:abort.signal});}
	};
	try{return await launchInkInbox({invoke,teamId,project:String(invocation.options.project??''),kind:String(invocation.options.type??'all'),showAll:invocation.options.all===true});}finally{abort.abort();}
}
