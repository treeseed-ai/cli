import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

test('package has one executable and only its declared CLI runtime dependencies', () => {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	assert.deepEqual(pkg.bin, { trsd: './dist/cli/main.js' });
	assert.equal(pkg.exports, undefined);
	assert.equal(pkg.types, undefined);
	assert.equal(pkg.files.some((path: string) => path.startsWith('scripts/')), false);
	assert.equal(pkg.dependencies['@treeseed/agent'], undefined);
	assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@treeseed/identity','@treeseed/sdk','ink','react','string-width','yaml']);
	assert.match(pkg.dependencies['@treeseed/identity'], /^0\.1\.0-rc\.\d+$/);
	assert.match(pkg.dependencies['@treeseed/sdk'], /^0\.13\.0-rc\.\d+$/);
	assert.match(pkg.devDependencies['@treeseed/deployment'], /^https:\/\/github\.com\/treeseed-ai\/deployment\/releases\/download\/0\.1\.0-rc\.\d+\/treeseed-deployment-runtime-0\.1\.0-rc\.\d+\.tgz$/);
	assert.equal(pkg.devDependencies['@treeseed/ui'], '>=0.12.18-rc.12 <0.14.0');
});

test('built package contains executable runtime only', () => {
	const custody = readFileSync('dist/cli/support/server-custody.js', 'utf8');
	assert.doesNotMatch(custody, /from\s*["']@treeseed\/deployment/u);
	assert.match(custody, /systemd-creds/u);
	assert.equal(existsSync('dist/cli/main.js'), true);
	assert.equal(existsSync('dist/cli/types.js'), false);
	assert.equal(readdirSync('dist', { recursive: true }).some((path) => String(path).endsWith('.d.ts')), false);
});

test('the shared Ink runtime is bundled against the CLI React peer', () => {
	const runtime = readFileSync('dist/cli/application/ui-runtime.js', 'utf8');
	assert.doesNotMatch(runtime, /(?:from\s*|require\()["']@treeseed\/ui(?:\/ink)?["']/u);
	assert.match(runtime, /from\s*["']react["']/u);
	assert.match(runtime, /from\s*["']ink["']/u);
});

test('the integrated shell accepts deterministic shared development scenes', () => {
	const runtime = readFileSync('src/cli/runtime.ts', 'utf8');
	const help = readFileSync('src/cli/help.ts', 'utf8');
	assert.match(runtime, /resolveDevelopmentScene\(sceneId\)/u);
	assert.match(runtime, /scene\?\.workspace/u);
	assert.match(runtime, /scene\?\.surface/u);
	assert.match(runtime, /development_scene_unknown/u);
	assert.match(help, /trsd ui --scene <scene>/u);
});

test('the executable drains complete output before exiting', () => {
	const main = readFileSync('src/cli/main.ts', 'utf8');
	assert.equal(main.includes('process.exit('), false);
	assert.equal(main.includes('process.exitCode = await runCommandLine'), true);
});

test('candidate promotion uses staging while stable publication uses production', () => {
	const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');
	const install = workflow.indexOf('npm ci --ignore-scripts --no-audit --no-fund');
	const verify = workflow.indexOf('npm run release:custody -- verify');
	assert.equal(workflow.includes('hydrate-exact-sdk.sh'), false);
	assert.ok(install >= 0 && verify > install);
	assert.match(workflow, /environment: \$\{\{ contains\(github\.ref_name, '-'\) && 'staging' \|\| 'production' \}\}/u);
	assert.match(workflow, /candidate_branch=staging; else candidate_branch=main/u);
});

test('source contains no legacy implementation residue', () => {
	const walk = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${root}/${entry.name}`) : [`${root}/${entry.name}`]);
	const files = walk('src').join('\n');
	for (const forbidden of ['handlers/capacity', 'workspace-lifecycle', 'handlers/hosting', 'handlers/treedx', 'handlers/scenes', 'handlers/seeds', 'handlers/agents']) assert.equal(files.includes(forbidden), false, forbidden);
	const sourceFiles = walk('src');
	const source = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
	for (const forbidden of ['MarketClient', 'marketId', '--market', 'operator/commands', 'workflow-support']) assert.equal(source.includes(forbidden), false, forbidden);
	const nonHostTransport = sourceFiles.filter((file) => !file.endsWith('/host-client.ts')).map((file) => readFileSync(file, 'utf8')).join('\n');
	assert.equal(nonHostTransport.includes('/v1/'), false, '/v1/ outside the fixed host-manager transport');
	for (const removed of ['docs/src', '.gitmodules']) assert.equal(existsSync(removed), false, removed);
});

test('guarantee metadata binds owner tests without adding a second CLI implementation', () => {
	const reporting: Record<string,{testFile:string;testName:string}> = {
		'cli.golden.operation-build-unit': {testFile:"tests/unit/command-boundary/development/source-closure.test.ts",testName:"freeze command custody rejects build working directories before source capture"},
		'cli.golden.operation-contract-unit': {testFile:"tests/unit/command-boundary/development/source-closure.test.ts",testName:"freeze command custody rejects contract working directories before source capture"},
		'cli.golden.operation-missing-unit': {testFile:"tests/unit/command-boundary/development/source-closure.test.ts",testName:"freeze command custody rejects missing working directories before source capture"},
		'cli.golden.operation-file-unit': {testFile:"tests/unit/command-boundary/development/source-closure.test.ts",testName:"freeze command custody rejects file working directories before source capture"},
		'cli.golden.operation-cycle-unit': {testFile:"tests/unit/command-boundary/development/source-closure.test.ts",testName:"freeze command custody rejects cycle working directories before source capture"},
		'cli.golden.operation-contained-unit': {testFile:"tests/unit/command-boundary/development/source-closure.test.ts",testName:"freeze command custody preserves canonical contained directory aliases and default roots"},
		'cli.golden.operation-moved-unit': {testFile:"tests/unit/command-boundary/development/source-closure.test.ts",testName:"freeze command custody rejects an ignored directory alias moving after capture"},
		'cli.golden.operation-freeze-native': {testFile:"tests/integration/development-operations.test.ts",testName:"native freeze rejects an escaped command directory before executing its actual subprocess"},
		'cli.golden.operation-contract-native': {testFile:"tests/integration/development-operations.test.ts",testName:"native freeze preflights escaped contract directories before its otherwise valid build"},
		'cli.golden.operation-targets-native': {testFile:"tests/integration/development-operations.test.ts",testName:"native freeze preflights every selected target directory before any native build"},
		'cli.golden.operation-verify-native': {testFile:"tests/integration/development-operations.test.ts",testName:"native candidate verification rejects an escaped directory before its actual verifier"},
		'cli.golden.operation-verifiers-native': {testFile:"tests/integration/development-operations.test.ts",testName:"native candidate verification preflights every verifier directory before the first native command"},
		'cli.golden.operation-alias-native': {testFile:"tests/integration/development-operations.test.ts",testName:"native candidate commands preserve contained directory aliases and exact working-directory execution"},
		'cli.golden.operation-freeze-moved-native': {testFile:"tests/integration/development-operations.test.ts",testName:"native freeze rejects ignored command directory movement after one actual execution"},
		'cli.golden.operation-verify-moved-native': {testFile:"tests/integration/development-operations.test.ts",testName:"native verify rejects ignored command directory movement after one actual execution"},
		'cli.golden.artifact-escaped-unit': {testFile:"tests/unit/command-boundary/development/artifact-custody.test.ts",testName:"artifact custody rejects escaped bytes through the existing freeze boundary"},
		'cli.golden.build-manager-unit': {testFile:"tests/unit/command-boundary/development/build-custody.test.ts",testName:"development build custody recognizes the existing protected manager target"},
		'cli.golden.build-docker-unit': {testFile:"tests/unit/command-boundary/development/build-custody.test.ts",testName:"development build custody recognizes a caller-built Docker runtime"},
		'cli.golden.build-direct-unit': {testFile:"tests/unit/command-boundary/development/build-custody.test.ts",testName:"development build custody leaves a direct native runtime in caller custody"},
		'cli.golden.build-once-native': {testFile:"tests/integration/development-rebuild.test.ts",testName:"native development rebuild executes its caller build once before selecting exact output"},
		'cli.golden.build-non-idempotent-native': {testFile:"tests/integration/development-rebuild.test.ts",testName:"native development rebuild does not repeat a non-idempotent successful build"},
		'cli.golden.build-failure-native': {testFile:"tests/integration/development-rebuild.test.ts",testName:"native development rebuild preserves selection and avoids stop after a failed build"},
		'cli.golden.build-refused-native': {testFile:"tests/integration/development-rebuild.test.ts",testName:"native development rebuild runs once and preserves selection when stop is refused"},
		'cli.golden.build-plan-native': {testFile:"tests/integration/development-rebuild.test.ts",testName:"native development rebuild plan neither builds nor refreshes manager state"},
		'cli.golden.build-manager-native': {testFile:"tests/integration/development-rebuild.test.ts",testName:"native development rebuild never executes a protected manager-owned build in the caller"},
		'cli.golden.build-missing-native': {testFile:"tests/integration/development-rebuild.test.ts",testName:"native development rebuild rejects an undeclared caller build before stop or selection"},
		'cli.golden.artifact-directory-unit': {testFile:"tests/unit/command-boundary/development/artifact-custody.test.ts",testName:"artifact custody rejects directory bytes through the existing freeze boundary"},
		'cli.golden.artifact-unreadable-unit': {testFile:"tests/unit/command-boundary/development/artifact-custody.test.ts",testName:"artifact custody rejects unreadable bytes through the existing freeze boundary"},
		'cli.golden.artifact-fifo-unit': {testFile:"tests/unit/command-boundary/development/artifact-custody.test.ts",testName:"artifact custody rejects fifo bytes through the existing freeze boundary"},
		'cli.golden.artifact-broken-unit': {testFile:"tests/unit/command-boundary/development/artifact-custody.test.ts",testName:"artifact custody rejects broken bytes through the existing freeze boundary"},
		'cli.golden.artifact-contained-unit': {testFile:"tests/unit/command-boundary/development/artifact-custody.test.ts",testName:"artifact custody admits contained bytes through the existing freeze boundary"},
		'cli.golden.artifact-regular-unit': {testFile:"tests/unit/command-boundary/development/artifact-custody.test.ts",testName:"artifact custody admits regular bytes through the existing freeze boundary"},
		'cli.golden.artifact-freeze-owner': {testFile:"tests/integration/development-artifacts.test.ts",testName:"native freeze rejects escaped artifact bytes before persisting or registering a candidate"},
		'cli.golden.artifact-verify-owner': {testFile:"tests/integration/development-artifacts.test.ts",testName:"native candidate verification rejects escaped identical artifact bytes before its verifier"},
		'cli.golden.artifact-alias-native': {testFile:"tests/integration/development-artifacts.test.ts",testName:"native owned artifact aliases preserve regular output verification and dirty candidate rules"},
		'cli.golden.artifact-between-native': {testFile:"tests/integration/development-artifacts.test.ts",testName:"native candidate verification rejects identical escaped artifact bytes after its owned command"},
		'cli.golden.artifact-fifo-native': {testFile:"tests/integration/development-artifacts.test.ts",testName:"native freeze rejects FIFO output promptly without a registered candidate or retained lock"},
		'cli.golden.freeze-source-unit': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'freeze custody binds exact source snapshots independently of command success'},
		'cli.golden.freeze-artifact-unit': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'freeze custody rejects changed or missing captured artifacts while allowing uncaptured outputs'},
		'cli.golden.freeze-output-unit': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'development closure excludes only declared artifact bytes while retaining source mutations'},
		'cli.golden.freeze-head-unit': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'development closure detects moved HEAD with unchanged tracked source bytes'},
		'cli.golden.freeze-tracked': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze rejects tracked mutation before contract execution or candidate registration'},
		'cli.golden.freeze-untracked': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze rejects untracked mutation before contract execution or candidate registration'},
		'cli.golden.freeze-head': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze rejects head mutation before contract execution or candidate registration'},
		'cli.golden.freeze-recipe': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze rejects recipe mutation before contract execution or candidate registration'},
		'cli.golden.freeze-contract': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze rejects contract source mutation and releases the freeze lock'},
		'cli.golden.freeze-all-owners': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze checks every owner after each build before later owner side effects'},
		'cli.golden.freeze-earlier-artifact': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze rejects earlier artifact mutation by a later owner build'},
		'cli.golden.freeze-repeat': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze preserves repeated declared outputs and dirty source without claiming a verification pass'},
		'cli.golden.freeze-failure': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze failure retains partial outputs without persisting or registering a candidate'},
		'cli.golden.freeze-wildcard': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze admits new wildcard output directories without treating generated bytes as source'},
		'cli.golden.freeze-empty-target': {testFile:'tests/integration/development-freeze.test.ts',testName:'native freeze blocks a target with no declared outputs before executing a later build'},
		'cli.golden.source-parent': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'development closure rejects a selected directory borrowing its parent Git root'},
		'cli.golden.source-git-loss': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'development closure rejects Git loss even when the parent retains the same commit'},
		'cli.golden.source-linked-root': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'development closure accepts exact linked Git worktrees and canonical root aliases'},
		'cli.golden.candidate-preflight-source': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification rejects changed tracked source before executing any verifier'},
		'cli.golden.candidate-preflight-owner': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification rejects a later artifact without an owned verifier before any side effect'},
		'cli.golden.candidate-preflight-artifact': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification checks every artifact before the first verifier executes'},
		'cli.golden.candidate-between-source': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification blocks later verifiers after source mutation in the first operation'},
		'cli.golden.candidate-between-artifact': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification blocks later verifiers after an earlier artifact changes'},
		'cli.golden.candidate-once': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification executes each owned target once while checking all its artifacts'},
		'cli.golden.source-bytes': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'development source digest binds same-size untracked binary bytes and newline paths'},
		'cli.golden.source-mode': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'development source digest binds untracked executable mode and symbolic link identity'},
		'cli.golden.source-ignore': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'development source digest retains tracked edits and ignores Git-excluded output'},
		'cli.golden.source-unreadable': {testFile:'tests/unit/command-boundary/development/source-closure.test.ts',testName:'development source planning rejects unreadable untracked bytes without manager effects'},
		'cli.golden.candidate-bytes': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification rejects untracked bytes changes without registering a pass'},
		'cli.golden.candidate-mode': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification rejects untracked mode changes without registering a pass'},
		'cli.golden.candidate-link': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification rejects untracked link changes without registering a pass'},
		'cli.golden.candidate-deletion': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification rejects untracked deleted changes without registering a pass'},
		'cli.golden.candidate-addition': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification rejects untracked added changes without registering a pass'},
		'cli.golden.candidate-mutation': {testFile:'tests/integration/development-candidate.test.ts',testName:'native candidate verification rejects untracked during verification changes without registering a pass'},
		'cli.golden.dirty-candidate': {testFile:'tests/integration/development-candidate.test.ts',testName:'native dirty candidate verification excludes generated artifact and remains non-promotable'},
		'cli.golden.source-files': {testFile:'tests/unit/source-custody.test.ts',testName:'complete CLI source is readable owner files without undeclared external Git links'},
		'cli.golden.source-checkout': {testFile:'tests/integration/source-custody.test.ts',testName:'fresh native Git checkout materializes every CLI source entry without missing-directory sentinels'},
		'cli.golden.sdk-agreement': {testFile:'tests/unit/dependency-sbom.test.ts',testName:'exact SDK artifact agrees with both dependency declarations before acceptance'},
		'cli.golden.sbom-authority': {testFile:'tests/unit/dependency-sbom.test.ts',testName:'strict SBOM is generated once by release verification before tests and candidate sealing'},
		'cli.golden.sbom-native': {testFile:'tests/integration/dependency-sbom.test.ts',testName:'strict native SBOM accepts exact installed artifacts and refuses mismatched missing malformed dependencies'},
		'cli.golden.workflow-triggers': {testFile:'tests/contract/package/thin-package.test.ts',testName:'verification retains every PR protected branch and tag without duplicate topic pushes'},
		'cli.golden.reporting-deadlines': {testFile:'tests/unit/native-suite-reporting.test.ts',testName:'native reporting cannot replace original suite deadlines or interrupt policy through reporting flags'},
		'cli.golden.native-reporting': {testFile:'tests/integration/native-suite-reporting.test.ts',testName:'native complete reporting preserves build discovery custody and nested subprocess defaults'},
		'cli.golden.reporting-denial': {testFile:'tests/integration/native-suite-reporting.test.ts',testName:'native reporter arguments reject filters unknown flags and malformed pairs before test side effects'},
		'cli.golden.reporting-outcomes': {testFile:'tests/integration/native-suite-reporting.test.ts',testName:'native reporting retains failed skipped todo empty and crashed suite outcomes'},
		'cli.golden.reporting-unit': {testFile:'tests/unit/native-suite-reporting.test.ts',testName:'native reporting accepts only a complete nonempty reporting pair without test selection'},
	};
	const observedReporting = new Set<string>();
	const files = readdirSync('guarantees', { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
	assert.equal(files.length, 3);
	for (const entry of files) {
		assert.match(entry.name, /\.yaml$/u);
		const document = parse(readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8'));
		assert.match(document.schemaVersion, /^treeseed\.(guarantee|scene|guarantee-verifiers)\/v1$/u);
		if (document.verifiers) for (const [ref,verifier] of Object.entries(document.verifiers) as Array<[string,{kind: string; ownerPackage: string; testFile: string;testName:string}]>) {
			assert.equal(verifier.kind, 'nodeTestCase');
			assert.equal(verifier.ownerPackage, '@treeseed/cli');
			if (Object.hasOwn(reporting,ref)) {
				assert.deepEqual({testFile:verifier.testFile,testName:verifier.testName},reporting[ref]);
				observedReporting.add(ref);
			} else assert.match(verifier.testFile, /^tests\/unit\/command-boundary\//u);
			assert.equal(existsSync(verifier.testFile), true);
		}
	}
	assert.deepEqual([...observedReporting].sort(),Object.keys(reporting).sort());
});

test('verification retains every PR protected branch and tag without duplicate topic pushes',()=>{
	const workflow=parse(readFileSync('.github/workflows/verify.yml','utf8'));
	assert.deepEqual(workflow.on.push.branches,['staging','main']);
	assert.deepEqual(workflow.on.push.tags,['**']);
	assert.deepEqual(workflow.on.push['paths-ignore'],['docs/src/content/**']);
	assert.deepEqual(workflow.on.pull_request['paths-ignore'],['docs/src/content/**']);
	assert.equal(Object.hasOwn(workflow.on,'workflow_dispatch'),true);
});
