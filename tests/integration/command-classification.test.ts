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

  async parser():Promise<void> {
    const app=new CliApplication();
    expect((await app.execute(['--help'])).code).toBe(0);expect((await app.execute(['--version'])).code).toBe(0);
    expect((await app.execute(['doctor','--json','--port','bad'])).code).toBe(2);
    expect((await app.execute(['apply'])).code).toBe(3);
  }
}
const suite=new CliTestsIntegration();
test("integration: parser help, version and error classifications",suite.parser.bind(suite));
