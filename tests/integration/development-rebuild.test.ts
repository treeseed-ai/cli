import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {DevelopmentRuntime} from '@treeseed/sdk/development';
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

function configureBuild(f:Awaited<ReturnType<typeof rebuildFixture>>,cwd:string,script:string) {
 const path=resolve(f.root,'treeseed.package.yaml'),document=JSON.parse(readFileSync(path,'utf8')) as {development:DevelopmentRuntime};
 const operation=document.development.targets[0]!.operations.build!;operation.cwd=cwd;operation.args=['--import',import.meta.resolve('tsx'),resolve(f.root,'scripts/build.ts')];
 writeFileSync(path,JSON.stringify(document));writeFileSync(resolve(f.root,'scripts/build.ts'),script);
}
test('native live rebuild rejects an escaped build directory before execution or selection',async()=>{
 const f=await rebuildFixture(),outside=await rebuildFixture();try{
  symlinkSync(outside.root,resolve(f.root,'working'));
  configureBuild(f,'working',`import {appendFileSync,writeFileSync} from 'node:fs';appendFileSync('executed.outside','bad');appendFileSync(${JSON.stringify(resolve(f.root,'build.log'))},'1\\n');writeFileSync(${JSON.stringify(resolve(f.root,'candidate.bin'))},'built-1');\n`);
  assert.equal(await f.invoke(),1,f.output.join(''));assert.match(f.output.join(''),/working directory custody/);
  assert.equal(existsSync(resolve(outside.root,'executed.outside')),false);assert.deepEqual(f.builds(),[]);assert.equal(f.calls.includes('local.dev.container:stop'),false);assert.deepEqual(f.selectedBytes,[]);assert.equal(f.mode(),'candidate');
 }finally{f.close();outside.close();}
});
test('native live rebuild rejects moved build directory before stop or selection',async()=>{
 const f=await rebuildFixture(),outside=await rebuildFixture();try{
  symlinkSync('scripts',resolve(f.root,'working'));
  configureBuild(f,'working',`import {appendFileSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs';appendFileSync(${JSON.stringify(resolve(f.root,'build.log'))},'1\\n');writeFileSync(${JSON.stringify(resolve(f.root,'candidate.bin'))},'built-1');unlinkSync(${JSON.stringify(resolve(f.root,'working'))});symlinkSync(${JSON.stringify(outside.root)},${JSON.stringify(resolve(f.root,'working'))});\n`);
  assert.equal(await f.invoke(),1,f.output.join(''));assert.match(f.output.join(''),/working directory custody/);assert.deepEqual(f.builds(),['1']);assert.equal(readFileSync(resolve(f.root,'candidate.bin'),'utf8'),'built-1');
  assert.equal(f.calls.includes('local.dev.container:stop'),false);assert.deepEqual(f.selectedBytes,[]);assert.equal(f.mode(),'candidate');
 }finally{f.close();outside.close();}
});
test('native live rebuild preserves contained build aliases and exactly one selected output',async()=>{
 const f=await rebuildFixture();try{
  symlinkSync('scripts',resolve(f.root,'working'));
  configureBuild(f,'working',`import {appendFileSync,writeFileSync} from 'node:fs';if(process.cwd()!==${JSON.stringify(resolve(f.root,'scripts'))})throw Error('wrong cwd');appendFileSync(${JSON.stringify(resolve(f.root,'build.log'))},'1\\n');writeFileSync(${JSON.stringify(resolve(f.root,'candidate.bin'))},'built-1');\n`);
  assert.equal(await f.invoke(),0,f.output.join(''));assert.deepEqual(f.builds(),['1']);assert.deepEqual(f.selectedBytes,['built-1']);assert.equal(f.mode(),'candidate');
 }finally{f.close();}
});
test('native live rebuild keeps unused manager-owned build directories out of caller authority',async()=>{
 const f=await rebuildFixture({managerOwned:true,failAt:1}),outside=await rebuildFixture();try{
  symlinkSync(outside.root,resolve(f.root,'working'));configureBuild(f,'working',"throw Error('caller must not build');\n");
  assert.equal(await f.invoke(),0,f.output.join(''));assert.deepEqual(f.builds(),[]);assert.deepEqual(f.selectedBytes,['manager-owned']);assert.equal(f.mode(),'candidate');
 }finally{f.close();outside.close();}
});
