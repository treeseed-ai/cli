import assert from 'node:assert/strict';
import test from 'node:test';
import {usesManagedContainer} from '../../../../src/cli/commands/development.ts';
import {rebuildTarget} from '../../../support/development-rebuild.ts';

test('development build custody recognizes the existing protected manager target',()=>assert.equal(usesManagedContainer(rebuildTarget(true)),true));
test('development build custody recognizes a caller-built Docker runtime',()=>assert.equal(usesManagedContainer(rebuildTarget()),true));
test('development build custody leaves a direct native runtime in caller custody',()=>{
 const target=rebuildTarget();target.operations.start!.command=process.execPath;assert.equal(usesManagedContainer(target),false);
});
