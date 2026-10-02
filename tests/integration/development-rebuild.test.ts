import assert from 'node:assert/strict';
import test from 'node:test';
import {rebuildFixture} from '../support/development-rebuild.ts';

test('native development rebuild executes its caller build once before selecting exact output',async()=>{
 const f=await rebuildFixture();try{assert.equal(await f.invoke(),0,f.output.join(''));assert.deepEqual(f.builds(),['1']);assert.deepEqual(f.selectedBytes,['built-1']);assert.equal(f.mode(),'candidate');}finally{f.close();}
});
test('native development rebuild does not repeat a non-idempotent successful build',async()=>{
 const f=await rebuildFixture({failAt:2});try{assert.equal(await f.invoke(),0,f.output.join(''));assert.deepEqual(f.builds(),['1']);assert.deepEqual(f.selectedBytes,['built-1']);}finally{f.close();}
});
test('native development rebuild preserves selection and avoids stop after a failed build',async()=>{
 const f=await rebuildFixture({failAt:1});try{assert.equal(await f.invoke(),1);assert.deepEqual(f.builds(),['1']);assert.equal(f.mode(),'candidate');assert.equal(f.calls.includes('local.dev.container:stop'),false);assert.deepEqual(f.selectedBytes,[]);}finally{f.close();}
});
test('native development rebuild runs once and preserves selection when stop is refused',async()=>{
 const f=await rebuildFixture({rejectStop:true});try{assert.equal(await f.invoke(),1);assert.deepEqual(f.builds(),['1']);assert.equal(f.mode(),'candidate');assert.deepEqual(f.selectedBytes,[]);assert.equal(f.calls.filter(x=>x==='local.dev.container:stop').length,1);}finally{f.close();}
});
test('native development rebuild plan neither builds nor refreshes manager state',async()=>{
 const f=await rebuildFixture();try{assert.equal(await f.invoke('rebuild',true),0,f.output.join(''));assert.deepEqual(f.builds(),[]);assert.deepEqual(f.calls,['local.dev.status']);assert.equal(f.mode(),'candidate');assert.deepEqual(f.selectedBytes,[]);}finally{f.close();}
});
test('native development rebuild never executes a protected manager-owned build in the caller',async()=>{
 const f=await rebuildFixture({managerOwned:true,failAt:1});try{assert.equal(await f.invoke(),0,f.output.join(''));assert.deepEqual(f.builds(),[]);assert.deepEqual(f.selectedBytes,['manager-owned']);}finally{f.close();}
});
test('native development rebuild rejects an undeclared caller build before stop or selection',async()=>{
 const f=await rebuildFixture({missingBuild:true});try{assert.equal(await f.invoke(),1);assert.deepEqual(f.builds(),[]);assert.equal(f.calls.includes('local.dev.container:stop'),false);assert.equal(f.mode(),'candidate');assert.deepEqual(f.selectedBytes,[]);}finally{f.close();}
});
