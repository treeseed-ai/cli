import test from 'node:test';
import assert from 'node:assert/strict';
import { reportingArguments } from '../../scripts/testing/run-tests.ts';

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
