import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const runner = resolve(import.meta.dirname, '../../scripts/testing/run-tests.ts');
const fixtureEnvironment = {...process.env};
delete fixtureEnvironment.NODE_TEST_CONTEXT;
function fixture() {
	const root = mkdtempSync(resolve(tmpdir(), 'cli-native-report-'));
	for (const directory of ['tests/support','tests/nested','outside']) mkdirSync(resolve(root,directory),{recursive:true});
	symlinkSync(resolve(import.meta.dirname,'../../node_modules'),resolve(root,'node_modules'));
	writeFileSync(resolve(root,'package.json'),JSON.stringify({type:'module',scripts:{test:`node --import tsx build.ts && node --import tsx ${runner}`}}));
	writeFileSync(resolve(root,'build.ts'),"import {writeFileSync} from 'node:fs'; writeFileSync('built','yes');");
	writeFileSync(resolve(root,'tests/support/os-custody.mjs'),"globalThis.custodyLoaded=true;");
	writeFileSync(resolve(root,'tests/unit.test.ts'),"import test from 'node:test'; import assert from 'node:assert/strict'; import {appendFileSync,existsSync} from 'node:fs'; test('unit boundary',()=>{assert.equal(existsSync('built'),true); assert.equal(globalThis.custodyLoaded,true); appendFileSync('order','unit\\n');});");
	writeFileSync(resolve(root,'outside/child.ts'),"import test from 'node:test'; test('child boundary',()=>{});");
	writeFileSync(resolve(root,'tests/nested/integration.test.ts'),"import {suite,test} from 'node:test'; import assert from 'node:assert/strict'; import {appendFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process'; suite('integration suite',()=>{test('integration boundary',()=>{const env={...process.env}; delete env.NODE_TEST_CONTEXT; const child=spawnSync(process.execPath,['--import','tsx','--test','outside/child.ts'],{encoding:'utf8',env}); assert.equal(child.status,0); assert.match(child.stdout,/child boundary/); appendFileSync('order','integration\\n');});});");
	writeFileSync(resolve(root,'reporter.ts'),"export default async function* reporter(source){const names=[]; let total; for await(const e of source){if(e.type==='test:pass' && e.data.details.type==='test')names.push(e.data.name);if(e.type==='test:summary' && e.data.file===undefined)total=e.data.counts.tests;}yield JSON.stringify({names,total});}");
	buildSync({entryPoints:[resolve(root,'reporter.ts')],outfile:resolve(root,'reporter.js'),platform:'node',format:'esm'});
	return root;
}

test('native complete reporting preserves build discovery custody and nested subprocess defaults',()=>{
	const root=fixture();
	try {
		const destination=resolve(root,'report.json');
		const result=spawnSync('npm',['test','--',`--test-reporter=${resolve(root,'reporter.js')}`,`--test-reporter-destination=${destination}`],{cwd:root,encoding:'utf8',env:fixtureEnvironment});
		assert.equal(result.status,0,result.stderr);
		assert.equal(existsSync(destination),true,'root native report must be written');
		const report=JSON.parse(readFileSync(destination,'utf8'));
		assert.equal(report.total,2); assert.deepEqual(report.names.sort(),['integration boundary','unit boundary']);
		assert.deepEqual(readFileSync(resolve(root,'order'),'utf8').trim().split('\n').sort(),['integration','unit']);
	} finally {rmSync(root,{recursive:true,force:true});}
});

test('native reporter arguments reject filters unknown flags and malformed pairs before test side effects',()=>{
	const root=fixture();
	try {
		writeFileSync(resolve(root,'built'),'yes');
		for(const args of [
			['--test-name-pattern=unit'],['--test-only'],['--test-skip-pattern=integration'],['--test-shard=1/2'],['--unknown=value'],
			['--test-reporter='],['--test-reporter=spec'],['--test-reporter-destination=stdout'],
			['--test-reporter=spec','--test-reporter=spec','--test-reporter-destination=stdout'],
			['--test-reporter=spec','--test-reporter-destination=stdout','--test-reporter-destination=stderr'],
		]) {
			const result=spawnSync(process.execPath,['--import','tsx',runner,...args],{cwd:root,encoding:'utf8',env:fixtureEnvironment});
			assert.notEqual(result.status,0,`unsafe reporting request accepted: ${args.join(' ')}`);
			assert.equal(existsSync(resolve(root,'order')),false,'no tests may run for invalid flags');
		}
	} finally {rmSync(root,{recursive:true,force:true});}
});

test('native reporting retains failed skipped todo empty and crashed suite outcomes',()=>{
	for(const mode of ['failure','skip','todo','empty','crash','cancelled']) {
		const root=fixture();
		try {
			rmSync(resolve(root,'tests/unit.test.ts')); rmSync(resolve(root,'tests/nested/integration.test.ts'));
			if(mode!=='empty')writeFileSync(resolve(root,'tests/result.test.ts'),mode==='crash' ? "throw new Error('fixture crash');" : mode==='cancelled' ? "import test from 'node:test'; test('cancelled',()=>new Promise(()=>{}));" : `import test from 'node:test'; import assert from 'node:assert/strict'; test${mode==='skip'?'.skip':mode==='todo'?'.todo':''}('outcome',()=>{assert.equal(${mode==='failure'},false);});`);
			const result=spawnSync(process.execPath,['--import','tsx',runner,'--test-reporter=tap',`--test-reporter-destination=${resolve(root,'report.txt')}`],{cwd:root,encoding:'utf8',env:fixtureEnvironment});
			assert.equal(result.status===0,mode==='skip'||mode==='todo',mode);
			if(mode!=='empty')assert.equal(existsSync(resolve(root,'report.txt')),true,mode);
			if(mode==='skip'||mode==='todo')assert.match(readFileSync(resolve(root,'report.txt'),'utf8'),mode==='skip'?/SKIP/:/TODO/);
		} finally {rmSync(root,{recursive:true,force:true});}
	}
});
