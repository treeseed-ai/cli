import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

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
