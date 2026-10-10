import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { reportingArguments } from '../../scripts/testing/run-tests.ts';

test('component scene case execution inherits the same declared test-only OS boundary as complete suites without changing runtime or host acceptance', () => {
	const workflow = parse(readFileSync('.github/workflows/verify.yml', 'utf8'));
	const job = workflow.jobs.verify;
	const scenes = job.steps.filter((step: { uses?: string }) => step.uses?.includes('reviewer/.github/actions/run-scenes@'));
	assert.equal(scenes.length, 1);
	assert.equal(scenes[0].with.ids, 'guarantee.cli.golden.component-boundaries');
	assert.equal(scenes[0].env?.NODE_OPTIONS, '--import=${{ github.workspace }}/tests/support/os-custody.ts');
	assert.equal(Object.hasOwn(job.env, 'NODE_OPTIONS'), false);
	assert.match(readFileSync('scripts/testing/run-tests.ts', 'utf8'), /tests\/support\/os-custody\.ts/u);
});

test('native reporting accepts only a complete nonempty reporting pair without test selection',()=>{
	assert.deepEqual(reportingArguments([]),[]);
	for(const args of [
		['--test-reporter=/path with spaces/reporter.ts','--test-reporter-destination=/path with spaces/report.json'],
		['--test-reporter-destination=stdout','--test-reporter=tap'],
	]) assert.deepEqual(reportingArguments(args),args);
	for(const args of [
		['--test-reporter='],['--test-reporter=   ','--test-reporter-destination=stdout'],
		['--test-reporter=spec'],['--test-reporter-destination=stdout'],
		['--test-reporter=spec','--test-reporter-destination='],
		['--test-reporter=spec','--test-reporter=spec','--test-reporter-destination=stdout'],
		['--test-reporter=spec','--test-reporter-destination=stdout','--test-name-pattern=unit'],
		['--test-only'],['--test-shard=1/2'],['--test-skip-pattern=integration'],['tests/unit.test.ts'],['--test-concurrency=99'],
	]) assert.throws(()=>reportingArguments(args),/reporting/i);
});

test('native reporting cannot replace original suite deadlines or interrupt policy through reporting flags',()=>{
	for(const flag of ['--test-timeout=0','--test-timeout=25','--test-force-exit','--test-isolation=none'])
		assert.throws(()=>reportingArguments(['--test-reporter=tap','--test-reporter-destination=stdout',flag]),/reporting/i);
});
