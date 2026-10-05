import { controlPlaneOperation } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient } from '../support/client.js';
import { launchInkChat } from './interactive-chat-app.js';
export { chatTranscriptMarkdown, eventLine, nextInteractiveRecipients, prepareInteractiveMessage, renderInteractiveChat, requiredCommunicationAddresses, type ChatLine } from './interactive-chat-model.js';

type Row=Record<string,unknown>;
export async function runInteractiveChat(invocation:ParsedInvocation,context:CommandContext,teamId:string,initialChannel?:string){
	if(!context.interactiveUi||!process.stdin.isTTY||!process.stdout.isTTY)throw Object.assign(new Error('Interactive chat requires a TTY. Supply both a topic and message for non-interactive use.'),{category:'invalid_input',code:'communication_interactive_tty_required'});
	if(invocation.options.json||invocation.options.jsonStream)throw Object.assign(new Error('Interactive chat cannot emit JSON. Supply both a topic and message when using --json or --json-stream.'),{category:'invalid_input',code:'communication_interactive_json_invalid'});
	let {client}=await createControlPlaneClient(invocation,context,true);const abort=new AbortController();
	const invoke=async(id:string,input:{path:Row;query:Row;body:unknown},options:Row={})=>{
		try{return await client.invoke(controlPlaneOperation(id),input,{...options,signal:abort.signal});}
		catch(error){if(Number((error as Row)?.status)!==401)throw error;({client}=await createControlPlaneClient(invocation,context,true,true));return client.invoke(controlPlaneOperation(id),input,{...options,signal:abort.signal});}
	};
	try{return await launchInkChat({invoke,teamId,initialChannel,cwd:context.cwd});}finally{abort.abort();}
}
