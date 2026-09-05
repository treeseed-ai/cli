import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
test('extracted CLI custody imports without a manager or runtime Deployment package',()=>{
  const root=mkdtempSync(join(tmpdir(),'treeseed-cli-extracted-'));
  try {
    cpSync('dist',join(root,'dist'),{recursive:true});writeFileSync(join(root,'package.json'),'{"type":"module"}');
    mkdirSync(join(root,'node_modules','@treeseed'),{recursive:true});
    symlinkSync(resolve('node_modules/@treeseed/sdk'),join(root,'node_modules/@treeseed/sdk'),'dir');
    const result=spawnSync(process.execPath,['--input-type=module','-e',"import {inspectServerCustody} from './dist/cli/support/server-custody.js'; const result=inspectServerCustody({TREESEED_CONFIG_HOME:process.cwd()+'/config'}); if(result.custody!=='os'||result.encrypted)process.exit(1);"],{cwd:root,encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});
    assert.equal(result.status,0,result.stderr);
  }finally{rmSync(root,{recursive:true,force:true});}
});
