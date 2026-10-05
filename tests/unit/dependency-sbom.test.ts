import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
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
