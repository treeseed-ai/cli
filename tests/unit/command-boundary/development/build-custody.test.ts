import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runOneShotOperation,usesManagedContainer} from '../../../../src/cli/commands/development.ts';
import {rebuildTarget} from '../../../support/development-rebuild.ts';
import {candidateFixture} from '../../../support/development-candidate.ts';

test('development build custody recognizes the existing protected manager target',()=>assert.equal(usesManagedContainer(rebuildTarget(true)),true));
test('development build custody recognizes a caller-built Docker runtime',()=>assert.equal(usesManagedContainer(rebuildTarget()),true));
test('development build custody leaves a direct native runtime in caller custody',()=>{
 const target=rebuildTarget();target.operations.start!.command=process.execPath;assert.equal(usesManagedContainer(target),false);
});

function execute(f:ReturnType<typeof candidateFixture>,cwd:string) {
 const state={sessionId:'dev-unit',manifest:resolve(f.root,'treeseed.package.yaml'),processes:{},overlays:[],candidates:[]};
 const operation={command:process.execPath,args:['--import',import.meta.resolve('tsx'),resolve(f.root,'scripts/build.ts')],cwd,environment:{DECLARED_VALUE:'exact'},timeoutSeconds:10};
 runOneShotOperation(state,operation,f.root,'candidate',process.env,{RESOLVED_VALUE:'resolved'});
}
test('one-shot build custody rejects an escaped directory before native side effects',()=>{
 const f=candidateFixture(),outside=candidateFixture();try{
  symlinkSync(outside.root,resolve(f.root,'working'));
  writeFileSync(resolve(f.root,'scripts/build.ts'),"import {writeFileSync} from 'node:fs';writeFileSync('executed.outside','bad');\n");
  assert.throws(()=>execute(f,'working'),/working directory custody/);assert.equal(existsSync(resolve(outside.root,'executed.outside')),false);
 }finally{f.close();outside.close();}
});
test('one-shot build custody rejects directory movement after one native execution',()=>{
 const f=candidateFixture(),outside=candidateFixture();try{
  symlinkSync('scripts',resolve(f.root,'working'));
  writeFileSync(resolve(f.root,'scripts/build.ts'),`import {appendFileSync,unlinkSync,symlinkSync} from 'node:fs';appendFileSync(${JSON.stringify(resolve(f.root,'build.log'))},'ran\\n');unlinkSync(${JSON.stringify(resolve(f.root,'working'))});symlinkSync(${JSON.stringify(outside.root)},${JSON.stringify(resolve(f.root,'working'))});\n`);
  assert.throws(()=>execute(f,'working'),/working directory custody/);assert.equal(readFileSync(resolve(f.root,'build.log'),'utf8'),'ran\n');
 }finally{f.close();outside.close();}
});
test('one-shot build custody preserves contained aliases and original environment authority',()=>{
 const f=candidateFixture();try{
  symlinkSync('scripts',resolve(f.root,'working'));
  writeFileSync(resolve(f.root,'scripts/build.ts'),`import {writeFileSync} from 'node:fs';if(process.cwd()!==${JSON.stringify(resolve(f.root,'scripts'))}||process.env.DECLARED_VALUE!=='exact'||process.env.RESOLVED_VALUE!=='resolved'||process.env.TREESEED_DEVELOPMENT_WORKTREE!==${JSON.stringify(f.root)}||process.env.TREESEED_DEVELOPMENT_MODE!=='candidate')throw Error('authority mismatch');writeFileSync(${JSON.stringify(resolve(f.root,'build.log'))},'ran');\n`);
  execute(f,'working');assert.equal(readFileSync(resolve(f.root,'build.log'),'utf8'),'ran');
 }finally{f.close();}
});
