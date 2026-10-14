import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,execFile} from 'node:child_process';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';

test('strict native SBOM accepts exact installed artifacts and refuses mismatched missing malformed dependencies',()=>{
	const root=mkdtempSync(join(tmpdir(),'cli-sbom-'));
	const run=(args:string[])=>spawnSync('npm',args,{cwd:root,encoding:'utf8',timeout:30_000,env:{...process.env,NODE_OPTIONS:'',NODE_TEST_CONTEXT:''}});
	try{
		const dependency=join(root,'dependency');mkdirSync(dependency);
		writeFileSync(join(dependency,'package.json'),JSON.stringify({name:'sdk-fixture',version:'1.0.0'}));
		const pack=spawnSync('npm',['pack','--ignore-scripts','--json'],{cwd:dependency,encoding:'utf8',timeout:30_000});
		assert.equal(pack.error,undefined);assert.equal(pack.status,0,pack.stderr);
		const archive=JSON.parse(pack.stdout)[0].filename;
		writeFileSync(join(root,'package.json'),JSON.stringify({name:'cli-fixture',version:'1.0.0',dependencies:{'sdk-fixture':`file:dependency/${archive}`}}));
		const install=run(['install','--ignore-scripts','--no-audit','--no-fund']);assert.equal(install.error,undefined);assert.equal(install.status,0,install.stderr);
		// The installed tarball stays immutable while declarations are checked.
		const declaration=(version:string)=>writeFileSync(join(root,'package.json'),JSON.stringify({name:'cli-fixture',version:'1.0.0',dependencies:{'sdk-fixture':version}}));
		declaration('1.0.0');
		const good=run(['sbom','--sbom-format','cyclonedx']);assert.equal(good.error,undefined);assert.equal(good.status,0,good.stderr);
		assert.ok(JSON.parse(good.stdout).components.some((component:{name:string;version:string})=>component.name==='sdk-fixture'&&component.version==='1.0.0'));
		declaration('1.0.1');const mismatch=run(['sbom','--sbom-format','cyclonedx']);assert.equal(mismatch.status,1);assert.match(mismatch.stderr,/ESBOMPROBLEMS/u);
		declaration('1.0.0');rmSync(join(root,'node_modules','sdk-fixture'),{recursive:true,force:true});
		const missing=run(['sbom','--sbom-format','cyclonedx']);assert.equal(missing.status,1);assert.match(missing.stderr,/ESBOMPROBLEMS/u);
		mkdirSync(join(root,'node_modules','sdk-fixture'));writeFileSync(join(root,'node_modules','sdk-fixture','package.json'),'{');
		const malformed=run(['sbom','--sbom-format','cyclonedx']);assert.notEqual(malformed.status,0);assert.equal(malformed.error,undefined);
	}finally{rmSync(root,{recursive:true,force:true});}
});
test('native held SDK hydration preserves locked peers through exact replay and denied archive without changing original source bytes',{timeout:30_000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'cli-held-sdk-')),archiveRoot=join(root,'archives'),input=join(root,'input'),source=process.cwd();
 const run=async(command:string,args:string[],cwd=root)=>promisify(execFile)(command,args,{cwd,encoding:'utf8',timeout:10_000,maxBuffer:4*1024*1024,env:{...process.env,NODE_OPTIONS:'',NODE_TEST_CONTEXT:'',PATH:process.env.PATH}});
 try{
  for(const path of[archiveRoot,input,join(root,'node_modules/@treeseed/sdk/dist'),join(root,'node_modules/react')])mkdirSync(path,{recursive:true});
  const sdk={name:'@treeseed/sdk',version:'1.0.0',type:'module',files:['dist'],exports:{'.':'./dist/index.js'},dependencies:{}};
  writeFileSync(join(input,'package.json'),JSON.stringify(sdk));mkdirSync(join(input,'dist'));writeFileSync(join(input,'dist/index.js'),'export const original = "held-input";\n');
  const packed=JSON.parse((await run('npm',['pack','--ignore-scripts','--json','--pack-destination',archiveRoot],input)).stdout);assert.equal(packed.length,1);
  const archive=join(archiveRoot,packed[0].filename),sha=createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'@treeseed/cli',version:'1.0.0',dependencies:{'@treeseed/sdk':'1.0.0',react:'^19.2.8'}}));
  writeFileSync(join(root,'package-lock.json'),JSON.stringify({name:'@treeseed/cli',version:'1.0.0',lockfileVersion:3,packages:{'':{dependencies:{'@treeseed/sdk':'1.0.0',react:'^19.2.8'}},'node_modules/@treeseed/sdk':{version:'1.0.0',dependencies:{}},'node_modules/react':{version:'19.2.8'}}}));
  writeFileSync(join(root,'node_modules/@treeseed/sdk/package.json'),JSON.stringify(sdk));writeFileSync(join(root,'node_modules/@treeseed/sdk/dist/index.js'),'original locked SDK bytes');
  writeFileSync(join(root,'node_modules/react/package.json'),JSON.stringify({name:'react',version:'19.2.8'}));writeFileSync(join(root,'node_modules/react/index.js'),'original locked peer bytes');
  const lock=readFileSync(join(root,'package-lock.json')),peer=readFileSync(join(root,'node_modules/react/index.js')),manifest=readFileSync(join(root,'package.json'));
  const helper=resolve(source,'scripts/build/hydrate-exact-sdk.ts');
  const invoke=(path=archive,digest=sha)=>existsSync(helper)?run(process.execPath,['--import',resolve(source,'node_modules/tsx/dist/loader.mjs'),helper,path,digest]):run('bash',[resolve(source,'scripts/build/hydrate-exact-sdk.sh'),archiveRoot,'install']);
  await invoke();const held=readFileSync(join(root,'node_modules/@treeseed/sdk/dist/index.js'));assert.equal(held.toString(),'export const original = "held-input";\n');
  await invoke();assert.deepEqual(readFileSync(join(root,'node_modules/@treeseed/sdk/dist/index.js')),held);
  const concurrent=await Promise.allSettled([invoke(),invoke()]);assert.equal(concurrent.filter(value=>value.status==='fulfilled').length,1);assert.equal(concurrent.filter(value=>value.status==='rejected').length,1);
  assert.deepEqual(readFileSync(join(root,'node_modules/@treeseed/sdk/dist/index.js')),held);
  writeFileSync(join(root,'package.json'),JSON.stringify({...JSON.parse(manifest.toString()),dependencies:{'@treeseed/sdk':'1.0.0',react:'^19.2.8','missing-locked-dependency':'1.0.0'}}));
  await assert.rejects(invoke());assert.deepEqual(readFileSync(join(root,'node_modules/@treeseed/sdk/dist/index.js')),held);writeFileSync(join(root,'package.json'),manifest);

  for(const[path,digest]of[[archive,'0'.repeat(64)],[join(root,'missing.tgz'),sha]]){
   await assert.rejects(invoke(path,digest));assert.deepEqual(readFileSync(join(root,'node_modules/@treeseed/sdk/dist/index.js')),held);
   assert.deepEqual(readFileSync(join(root,'package-lock.json')),lock);assert.deepEqual(readFileSync(join(root,'node_modules/react/index.js')),peer);
  }
  assert.deepEqual(readFileSync(join(root,'package.json')),manifest);assert.deepEqual(readFileSync(join(root,'package-lock.json')),lock);
  assert.deepEqual(readFileSync(join(root,'node_modules/react/index.js')),peer);assert.deepEqual(readdirSync(join(root,'node_modules/@treeseed')),['sdk']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
