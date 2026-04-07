#!/usr/bin/env node

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { collectCliPreflight } from './workspace-preflight-lib.ts';
import {
	applyTreeseedEnvironmentToProcess,
	ensureTreeseedGitignoreEntries,
	getTreeseedMachineConfigPaths,
	runTreeseedConfigWizard,
	writeTreeseedLocalEnvironmentFiles,
} from './config-runtime-lib.ts';

const tenantRoot = process.cwd();

function parseArgs(argv) {
	const parsed = {
		scopes: [],
		sync: 'none',
	};

	const rest = [...argv];
	while (rest.length) {
		const current = rest.shift();
		if (!current) {
			continue;
		}
		if (current === '--environment') {
			parsed.scopes.push(rest.shift() ?? '');
			continue;
		}
		if (current.startsWith('--environment=')) {
			parsed.scopes.push(current.split('=', 2)[1] ?? '');
			continue;
		}
		if (current === '--sync') {
			parsed.sync = rest.shift() ?? 'none';
			continue;
		}
		if (current.startsWith('--sync=')) {
			parsed.sync = current.split('=', 2)[1] ?? 'none';
			continue;
		}
		throw new Error(`Unknown config argument: ${current}`);
	}

	return parsed;
}

const options = parseArgs(process.argv.slice(2));
const scopes = options.scopes.length > 0 ? options.scopes : ['local', 'staging', 'prod'];

ensureTreeseedGitignoreEntries(tenantRoot);
const preflight = collectCliPreflight({ cwd: tenantRoot, requireAuth: false });
const rl = readline.createInterface({ input, output });

try {
	console.log('Treeseed configuration wizard');
	console.log('This command writes a local machine config, generates .env.local and .dev.vars, and can sync GitHub or Cloudflare settings.');
	console.log('Enter a value to set it, press Enter to keep the current/default value, or enter "-" to clear a value.\n');

	const result = await runTreeseedConfigWizard({
		tenantRoot,
		scopes,
		sync: options.sync,
		authStatus: preflight.checks.auth,
		prompt: async (message) => {
			if (!process.stdin.isTTY || !process.stdout.isTTY) {
				return '';
			}
			try {
				return await rl.question(message);
			} catch {
				return '';
			}
		},
	});

	writeTreeseedLocalEnvironmentFiles(tenantRoot);
	applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local' });
	const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);

	console.log('\nTreeseed config completed.');
	console.log(`Machine config: ${configPath}`);
	console.log(`Machine key: ${keyPath}`);
	console.log(`Updated values: ${result.updated.length}`);
	console.log(`Initialized environments: ${result.initialized.length}`);
	if (result.synced.github) {
		console.log(
			`GitHub sync: ${result.synced.github.secrets.length} secrets, ${result.synced.github.variables.length} variables (${result.synced.github.repository})`,
		);
	}
	if (result.synced.cloudflare) {
		console.log(
			`Cloudflare sync: ${result.synced.cloudflare.secrets.length} secrets, ${result.synced.cloudflare.varsManagedByWranglerConfig.length} vars via Wrangler config`,
		);
	}
} finally {
	rl.close();
}
