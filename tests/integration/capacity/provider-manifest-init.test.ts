import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateCapacityProviderManifestV2 } from '@treeseed/sdk/capacity-provider';
import { runCapacityProviderGovernanceAction } from '../../../src/cli/handlers/capacity/providers/capacity-provider-governance.ts';
import type { CommandContext, ParsedInvocation } from '../../../src/cli/types.ts';

describe('capacity provider manifest initialization', () => {
	it('plans a manifest that satisfies the current provider contract', async () => {
		const invocation: ParsedInvocation = {
			commandName: 'capacity',
			args: { action: 'provider-manifest-init', plan: true },
			positionals: ['provider-manifest-init'],
			rawArgs: [],
		};
		const context: CommandContext = {
			cwd: process.cwd(),
			env: {},
			write: () => undefined,
			spawn: () => ({ status: 0 }),
		};

		const result = await runCapacityProviderGovernanceAction('provider-manifest-init', invocation, context);
		assert.equal(result.exitCode, 0);
		const manifest = (result.report as { payload: unknown }).payload;
		assert.deepEqual(validateCapacityProviderManifestV2(manifest).diagnostics, []);
	});
});
