import assert from 'node:assert/strict';
import test from 'node:test';
import { findOperation } from '../../../src/cli/operations/operations-registry.ts';

test('contribution exposes one-time human grant and agent-safe diagnostic actions',()=>{
	const operation=findOperation('contribution');assert.ok(operation);assert.equal(operation.handlerName,'contribution');
	assert.match(operation.usage,/plan\|apply\|show\|revoke\|project\|diagnose/u);
	const options=new Map(operation.options?.map((option)=>[option.name,option]));
	for(const name of ['market','project','authorization','file','document','output','agent','provider','branch','yes','json'])assert.ok(options.has(name),`missing ${name}`);
	assert.match(operation.help?.automationNotes?.join(' ')??'',/Agents may run show and diagnose/u);
});
