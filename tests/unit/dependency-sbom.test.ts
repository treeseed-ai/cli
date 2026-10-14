import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hydrateExactSdk} from '../../scripts/build/hydrate-exact-sdk.js';
import {parse} from 'yaml';

test('exact SDK artifact agrees with both dependency declarations before acceptance',()=>{
	const pkg=JSON.parse(readFileSync('package.json','utf8'));
	const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
	const installed=JSON.parse(readFileSync('node_modules/@treeseed/sdk/package.json','utf8'));
	assert.equal(installed.name,'@treeseed/sdk');
	assert.equal(pkg.dependencies['@treeseed/sdk'],installed.version);
	assert.equal(lock.packages[''].dependencies['@treeseed/sdk'],installed.version);
	assert.equal(lock.packages['node_modules/@treeseed/sdk'].version,installed.version);
});

test('strict SBOM is generated once by release verification before tests and candidate sealing',()=>{
	const verify=readFileSync('scripts/packages/release-verify.ts','utf8');
	const workflow=parse(readFileSync('.github/workflows/verify.yml','utf8'));
	const sbom=verify.indexOf("run('npm', ['sbom', '--sbom-format', 'cyclonedx']");
	assert.ok(sbom>=0&&sbom<verify.indexOf("run('npm', ['test'])"));
	assert.equal((verify.match(/\['sbom', '--sbom-format', 'cyclonedx'\]/gu)??[]).length,1);
	assert.match(verify,/writeFileSync\(resolve\(packageRoot, 'artifacts', 'sbom\.cdx\.json'\)/u);
	const seal=workflow.jobs.verify.steps.find((step:{name?:string})=>step.name==='Seal protected staging candidate');
	assert.doesNotMatch(seal.run,/npm sbom/u);
	assert.match(seal.run,/release:custody -- seal/u);
});
test('held SDK hydration preserves locked bundled dependencies instead of resolving root ranges again',()=>{
 const workflow=parse(readFileSync('.github/workflows/verify.yml','utf8'));
 const step=workflow.jobs.verify.steps.find((step:{name?:string})=>step.name==='Verify and install held SDK archive');
 assert.ok(step);assert.doesNotMatch(step.run,/npm install/u,'a held SDK swap must not re-resolve React or another bundled dependency');
 assert.match(step.run,/scripts\/build\/hydrate-exact-sdk\.ts/u);
 assert.match(step.run,/TREESEED_TEST_SDK_ARCHIVE_SHA256/u);
 assert.match(step.run,/hydrate-exact-sdk\.ts "\$TREESEED_TEST_SDK_ARCHIVE"/u,'hydration requires the existing absolute held archive input');
 const root=mkdtempSync(join(tmpdir(),'cli-hydration-unit-')),sdk=join(root,'node_modules/@treeseed/sdk'),archive=join(root,'held.tgz');
 try{
  mkdirSync(sdk,{recursive:true});const manifest={name:'@treeseed/cli',dependencies:{'@treeseed/sdk':'1.0.0'}},lock={packages:{'':{dependencies:{'@treeseed/sdk':'1.0.0'}},'node_modules/@treeseed/sdk':{version:'1.0.0'}}};
  writeFileSync(join(root,'package.json'),JSON.stringify(manifest));writeFileSync(join(root,'package-lock.json'),JSON.stringify(lock));writeFileSync(join(sdk,'package.json'),JSON.stringify({name:'@treeseed/sdk',version:'1.0.0'}));writeFileSync(archive,'retained malformed archive bytes');
  const original=readFileSync(archive),source=readFileSync(join(root,'package.json')),locked=readFileSync(join(root,'package-lock.json'));
  for(const[path,sha]of[['relative.tgz','a'.repeat(64)],[archive,'unheld'],[join(root,'missing.tgz'),'a'.repeat(64)],[archive,'0'.repeat(64)]])assert.throws(()=>hydrateExactSdk(path,sha,root));
  const linked=join(root,'linked.tgz');symlinkSync(archive,linked);assert.throws(()=>hydrateExactSdk(linked,'a'.repeat(64),root));
  writeFileSync(join(root,'package.json'),JSON.stringify({...manifest,name:'@treeseed/foreign'}));assert.throws(()=>hydrateExactSdk(archive,'a'.repeat(64),root));writeFileSync(join(root,'package.json'),source);
  writeFileSync(join(root,'package-lock.json'),JSON.stringify({...lock,packages:{...lock.packages,'node_modules/@treeseed/sdk':{version:'1.0.1'}}}));assert.throws(()=>hydrateExactSdk(archive,'a'.repeat(64),root));writeFileSync(join(root,'package-lock.json'),locked);
  writeFileSync(join(sdk,'package.json'),JSON.stringify({name:'@treeseed/foreign',version:'1.0.0'}));assert.throws(()=>hydrateExactSdk(archive,'a'.repeat(64),root));
  assert.deepEqual(readFileSync(archive),original);assert.deepEqual(readFileSync(join(root,'package.json')),source);assert.deepEqual(readFileSync(join(root,'package-lock.json')),locked);assert.deepEqual(readdirSync(join(root,'node_modules/@treeseed')),['sdk']);
 }finally{rmSync(root,{recursive:true,force:true});}

});
