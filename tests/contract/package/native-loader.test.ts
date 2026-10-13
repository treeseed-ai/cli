import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePreloadArguments } from '../../support/native-loader.ts';

test('retains the original owning loader and import fence without importing CLI development dependencies or child test flags',()=>{
 const args=Object.freeze(['--import','data:text/javascript,original-fence','--import','/installed/reviewer/node_modules/tsx/dist/loader.mjs','--test','--test-reporter=json']);
 assert.deepEqual(nativePreloadArguments(args),args.slice(0,4));
 assert.deepEqual(args,['--import','data:text/javascript,original-fence','--import','/installed/reviewer/node_modules/tsx/dist/loader.mjs','--test','--test-reporter=json']);
});
test('retains combined import syntax and order through the same original loader without mutating native arguments',()=>{
 assert.deepEqual(nativePreloadArguments(['--test','--import=data:text/javascript,fence','--import=tsx','--test-concurrency=2']),
  ['--import=data:text/javascript,fence','--import=tsx']);
});
test('denies missing malformed or unrelated owning loaders instead of falling back to checkout dependencies',()=>{
 for(const args of [[],['--test'],['--import'],['--import',''],['--import','--test'],['--import='],['--import','data:text/javascript,fence'],['--import','unrelated-loader']])
  assert.throws(()=>nativePreloadArguments(args));
});
