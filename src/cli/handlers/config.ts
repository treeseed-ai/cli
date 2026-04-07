import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { TreeseedCommandHandler } from '../types.js';
import { collectCliPreflight } from '../../../scripts/workspace-preflight-lib.ts';
import {
	applyTreeseedEnvironmentToProcess,
	ensureTreeseedGitignoreEntries,
	getTreeseedMachineConfigPaths,
	runTreeseedConfigWizard,
	writeTreeseedLocalEnvironmentFiles,
} from '../../../scripts/config-runtime-lib.ts';
import { guidedResult } from './utils.js';

export const handleConfig: TreeseedCommandHandler = async (invocation, context) => {
	const commandName = invocation.commandName || 'config';
	const tenantRoot = context.cwd;
	const scopes = Array.isArray(invocation.args.environment)
		? invocation.args.environment
		: invocation.args.environment
			? [invocation.args.environment]
			: ['local', 'staging', 'prod'];
	const sync = typeof invocation.args.sync === 'string' ? invocation.args.sync : 'none';

	ensureTreeseedGitignoreEntries(tenantRoot);
	const preflight = collectCliPreflight({ cwd: tenantRoot, requireAuth: false });
	const rl = readline.createInterface({ input, output });

	try {
		if (context.outputFormat !== 'json') {
			context.write('Treeseed configuration wizard', 'stdout');
			context.write('This command writes a local machine config, generates .env.local and .dev.vars, and can sync GitHub or Cloudflare settings.', 'stdout');
			context.write('Enter a value to set it, press Enter to keep the current/default value, or enter "-" to clear a value.\n', 'stdout');
		}

		const result = await runTreeseedConfigWizard({
			tenantRoot,
			scopes,
			sync,
			authStatus: preflight.checks.auth,
			write: context.outputFormat === 'json' ? () => {} : ((line: string) => context.write(line, 'stdout')),
			prompt: async (message: string) => {
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
		return guidedResult({
			command: commandName,
			summary: `Treeseed ${commandName} completed successfully.`,
			facts: [
				{ label: 'Machine config', value: configPath },
				{ label: 'Machine key', value: keyPath },
				{ label: 'Updated values', value: result.updated.length },
				{ label: 'Initialized environments', value: result.initialized.map((entry: { scope: string }) => entry.scope).join(', ') || '(none)' },
				{ label: 'GitHub sync', value: result.synced.github ? `${result.synced.github.secrets.length} secrets, ${result.synced.github.variables.length} variables` : 'not run' },
				{ label: 'Cloudflare sync', value: result.synced.cloudflare ? `${result.synced.cloudflare.secrets.length} secrets, ${result.synced.cloudflare.varsManagedByWranglerConfig.length} vars` : 'not run' },
			],
			nextSteps: [
				...(scopes.includes('local') ? ['treeseed dev'] : []),
				...(scopes.includes('staging') ? ['treeseed deploy --environment staging'] : []),
				...(scopes.includes('prod') ? ['treeseed deploy --environment prod'] : []),
			],
			report: {
				scopes,
				sync,
				result,
				preflight,
			},
		});
	} finally {
		rl.close();
	}
};
