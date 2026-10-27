import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync, readdirSync, existsSync, readFileSync, statSync, chmodSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { createHash } from 'node:crypto';
import { PreparedReleaseFixture } from '@treeseed-cordis/deployment/testing';
import { CliApplication } from '../../src/main.js';
import { ServiceRuntimeFixture } from '@treeseed-cordis/deployment/testing/runtime';
import { ServiceWorkerBuild, ServicePlanStore } from '@treeseed-cordis/deployment';
import { PluginInstallationFixture } from '@treeseed-cordis/deployment/testing/plugins';
import { CanonicalJson, ServiceSchemas, PlatformSchemas, PluginManagementSchemas, type PluginInstallResult, type ServiceResourceReceipt, type CliEnvelope } from '@treeseed-cordis/sdk';
import {CliProgramFixture,CliTests,ProviderFixture,ExtensiblePlanProgramTests,InstalledProgramTests,InstalledPluginCliTests,LivePluginCliTests} from '../support/cli-program-test-support.js';
class CliTestsIntegration extends CliTests {

  async defaultComposition():Promise<void> {
    const root=mkdtempSync(join(tmpdir(),'cordis-default-'));
    try {const result=await new CliApplication().execute(['doctor','--installation',join(root,'new'),'--port',String(await this.port())]);expect(result.envelope.result).not.toBeNull();expect(result.envelope.command).toBe('doctor');expect(result.envelope.result&&'host' in result.envelope.result).toBe(true);expect(readdirSync(root)).toEqual([]);}
    finally {rmSync(root,{recursive:true,force:true});}
  }
}
const suite=new CliTestsIntegration();
test('integration: default CLI construction uses real packaged diagnostics',suite.defaultComposition.bind(suite));
