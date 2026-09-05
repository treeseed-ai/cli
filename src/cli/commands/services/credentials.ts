import { randomUUID } from 'node:crypto';
import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import { getServiceProviderDefinition } from '@treeseed/sdk/secrets-capability';
import type { CommandContext, ParsedInvocation } from '../../types.js';
import { createControlPlaneClient } from '../../support/client.js';
import { promptHidden } from '../../support/prompts.js';
const data = (value:any) => value?.data ?? value;
const invalid = () => Object.assign(new Error('Supply a valid credential field object through secret prompts or --stdin.'),{category:'invalid_input',code:'credential_input_invalid'});
export async function runServiceCredentials(invocation:ParsedInvocation,context:CommandContext) {
  const name=invocation.command.path.at(-1)!;
  const operations=CONTROL_PLANE_OPERATIONS.services;
  const operation={show:operations.credentialStatus,put:operations.putCredentials,delete:operations.deleteCredentials,validate:operations.validateCredentials}[name];
  if(!operation)throw invalid();
  const clientContext=context.operationInvoke?undefined:await createControlPlaneClient(invocation,context,true);
  const teamId=String(invocation.options.team ?? clientContext?.session?.activeTeam?.id ?? '');
  const path={teamId,connectionId:invocation.arguments[0]!,profileId:invocation.arguments[1]!};
  operation.schema.path.parse(path);
  const expectedVersion=Number(invocation.options['expected-version']);
  const invoke=async (binding:any,input:any)=>context.operationInvoke
    ? context.operationInvoke(binding.descriptor.operationId,input,{idempotencyKey:randomUUID()})
    : clientContext!.client.invoke(binding,input,{idempotencyKey:randomUUID()});
  if(invocation.options.plan===true)return {operation:operation.descriptor.operationId,...path,expectedVersion,mutation:false,custody:'openbao'};
  if(name!=='show'&&clientContext&&new URL(clientContext.profile.baseUrl).protocol!=='https:')
    throw Object.assign(new Error('Credential operations require an HTTPS control-plane server.'),{category:'policy_blocked',code:'credential_tls_required'});
  let body:any=name==='show'?undefined:{expectedVersion};
  if(name==='put') {
    let values:Record<string,string>={};
    if(invocation.options.stdin===true) {
      const input=String(await context.readStdin?.() ?? '');
      if(input.length>1024*1024)throw invalid();
      try {values=JSON.parse(input);}catch{throw invalid();}
    } else {
      if(!context.promptSecret&&!context.interactiveUi)throw invalid();
      const connection=data(await invoke(operations.connection,{path:{teamId,connectionId:path.connectionId},query:{},body:undefined}));
      const profile=getServiceProviderDefinition(connection.providerId)?.credentialProfiles.find(p=>p.id===path.profileId);
      if(!profile?.authoritySchemes.includes('openbao'))throw invalid();
      for(const field of profile.fields.filter(f=>f.sensitive)) {
        const value=String(await (context.promptSecret ?? promptHidden)(`${field.label}${field.required?'':' (optional)'}: `));
        if(value)values[field.key]=value;
      }
    }
    body={expectedVersion,values};
  }
  const parsed=operation.schema.body.safeParse(body);
  if(!parsed.success)throw invalid();
  try {return data(await invoke(operation,{path,query:{},body:parsed.data}));}
  finally {
    for (const value of [body, parsed.data]) {
      if(value?.values)for(const key of Object.keys(value.values))delete value.values[key];
    }
  }
}
