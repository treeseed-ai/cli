import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommandContext, ParsedInvocation } from '../../../src/cli/types.ts';
import {
	MUTATING_CAPACITY_GOVERNANCE_ACTIONS,
	runCapacityGovernanceAction,
} from '../../../src/cli/handlers/capacity/capacity-core/capacity-governance.ts';

function invocation(action: string, yes = false): ParsedInvocation {
	return {
		commandName: 'capacity',
		args: {
			action,
			team: 'team-a',
			...(action === 'registration-key-rotate' ? { execute: true } : {}),
			...(yes ? { yes: true } : {}),
		},
		positionals: [action],
		rawArgs: [],
	};
}

function context(confirm?: CommandContext['confirm']): CommandContext {
	return {
		cwd: process.cwd(),
		env: {},
		write: () => undefined,
		spawn: () => ({ status: 0 }),
		confirm,
	};
}

describe('capacity registration-key secret confirmation', () => {
	for (const action of ['registration-key-reveal', 'registration-key-rotate']) {
		it(`blocks noninteractive ${action} before creating a client`, async () => {
			const result = await runCapacityGovernanceAction(action, invocation(action), context());
			assert.equal(result.exitCode, 1);
			assert.match(result.stderr?.join('\n') ?? '', /requires explicit confirmation/u);
		});

		it(`honors an explicit negative confirmation for ${action}`, async () => {
			let prompts = 0;
			const result = await runCapacityGovernanceAction(action, invocation(action), context(() => {
				prompts += 1;
				return false;
			}));
			assert.equal(prompts, 1);
			assert.equal(result.exitCode, 1);
		});
	}

	it('requires an explicit plan or live mode for every governance mutation before creating a client', async () => {
		for (const action of MUTATING_CAPACITY_GOVERNANCE_ACTIONS) {
			const result = await runCapacityGovernanceAction(action, {
				...invocation(action),
				args: { action, team: 'team-a' },
			}, context());
			assert.equal(result.exitCode, 1, action);
			assert.match(result.stderr?.join('\n') ?? '', /Choose exactly one of --plan or --execute/u, action);
		}
	});
});
