import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CAPACITY_OPERATOR_CAPABILITIES } from '@treeseed/sdk/agent-capacity';
import { CAPACITY_AGENT_CLASS_ACTIONS } from '../../../src/cli/handlers/capacity/agents/capacity-agent-classes.ts';
import { CAPACITY_AGENT_SIMULATION_ACTIONS } from '../../../src/cli/handlers/capacity/agents/capacity-agent-simulation.ts';
import { CAPACITY_AGENT_DEPLOYMENT_ACTIONS } from '../../../src/cli/handlers/capacity/agents/capacity-agent-deployments.ts';
import { CAPACITY_ASSIGNMENT_ACTIONS } from '../../../src/cli/handlers/capacity/assignments/capacity-assignments.ts';
import { CAPACITY_CHECKPOINT_INTEGRATION_ACTIONS } from '../../../src/cli/handlers/capacity/capacity-core/capacity-checkpoint-integration.ts';
import { CAPACITY_CONTENT_INTEGRATION_ACTIONS } from '../../../src/cli/handlers/capacity/capacity-core/integration/capacity-content-integration.ts';
import { CAPACITY_DISCUSSION_ACTIONS } from '../../../src/cli/handlers/capacity/capacity-core/integration/capacity-discussions.ts';
import { CAPACITY_EVIDENCE_ACTIONS } from '../../../src/cli/handlers/capacity/observability/capacity-evidence.ts';
import { CAPACITY_GOVERNANCE_ACTIONS } from '../../../src/cli/handlers/capacity/capacity-core/capacity-governance.ts';
import { CAPACITY_OVERRUN_ACTIONS } from '../../../src/cli/handlers/capacity/accounting/capacity-overruns.ts';
import { CAPACITY_PROVIDER_GOVERNANCE_ACTIONS } from '../../../src/cli/handlers/capacity/providers/capacity-provider-governance.ts';
import { CAPACITY_PLAN_ACTIONS } from '../../../src/cli/handlers/capacity/planning/capacity-plans.ts';
import {
	MARKET_INSPECTION_ACTIONS,
	PROVIDER_LIFECYCLE_ACTIONS,
} from '../../../src/cli/handlers/capacity/capacity-core/capacity.ts';
import { CAPACITY_WORKDAY_ACTIONS } from '../../../src/cli/handlers/capacity/workdays/lifecycle/capacity-workday.ts';
import { CAPACITY_WORKDAY_SCHEDULE_ACTIONS } from '../../../src/cli/handlers/capacity/workdays/lifecycle/capacity-workday-schedules.ts';
import { CAPACITY_WORKDAY_WATCH_ACTIONS } from '../../../src/cli/handlers/capacity/workdays/observability/capacity-workday-watch.ts';
import { CAPACITY_ASSIGNMENT_ARTIFACT_ACTIONS } from '../../../src/cli/handlers/capacity/assignments/capacity-assignment-artifacts.ts';

const REQUIRED_SELF_DEVELOPMENT_ACTIONS = [
	'capacity-plan-create', 'capacity-plan-accept', 'capacity-plan-request-revision', 'capacity-plan-schedule', 'capacity-plan-supersede',
	'workday-run', 'workday-close-admission', 'workday-run-complete', 'workday-run-cancel', 'agent-author', 'agent-definitions-author', 'agent-simulation-run',
	'context-query-test',
	'context-query-checks', 'agent-deploy', 'agent-deployment', 'agent-deployment-activate', 'agent-deployment-upgrade',
	'assignment-authority-probe','assignment-cancel', 'assignment-requeue', 'checkpoint-integrate', 'content-abandon', 'content-integrate', 'capabilities',
	'discussion-read','discussion-send',
];

function cliOwners() {
	return [
		CAPACITY_AGENT_CLASS_ACTIONS,
		CAPACITY_AGENT_DEPLOYMENT_ACTIONS,
		CAPACITY_AGENT_SIMULATION_ACTIONS,
		CAPACITY_ASSIGNMENT_ACTIONS,
		CAPACITY_ASSIGNMENT_ARTIFACT_ACTIONS,
		CAPACITY_CHECKPOINT_INTEGRATION_ACTIONS,
		CAPACITY_CONTENT_INTEGRATION_ACTIONS,
		CAPACITY_DISCUSSION_ACTIONS,
		CAPACITY_EVIDENCE_ACTIONS,
		CAPACITY_GOVERNANCE_ACTIONS,
		CAPACITY_OVERRUN_ACTIONS,
		CAPACITY_PLAN_ACTIONS,
		CAPACITY_PROVIDER_GOVERNANCE_ACTIONS,
		MARKET_INSPECTION_ACTIONS,
		PROVIDER_LIFECYCLE_ACTIONS,
		CAPACITY_WORKDAY_ACTIONS,
		CAPACITY_WORKDAY_SCHEDULE_ACTIONS,
		CAPACITY_WORKDAY_WATCH_ACTIONS,
	];
}

describe('capacity operator parity', () => {
	it('has exactly one CLI handler owner for every canonical capability', () => {
		const ownership = new Map<string, number>();
		for (const owner of cliOwners()) for (const action of owner) ownership.set(action, (ownership.get(action) ?? 0) + 1);
		const missing = CAPACITY_OPERATOR_CAPABILITIES.filter((capability) => !ownership.has(capability.cliAction)).map((capability) => capability.cliAction);
		const duplicated = CAPACITY_OPERATOR_CAPABILITIES.filter((capability) => ownership.get(capability.cliAction) !== 1)
			.map((capability) => ({ action: capability.cliAction, owners: ownership.get(capability.cliAction) ?? 0 }));
		assert.deepEqual(missing, []);
		assert.deepEqual(duplicated, []);
	});

	it('discovers every source-development lifecycle action through exactly one CLI owner', () => {
		const ownership = new Map<string, number>();
		for (const owner of cliOwners()) for (const action of owner) ownership.set(action, (ownership.get(action) ?? 0) + 1);
		assert.deepEqual(REQUIRED_SELF_DEVELOPMENT_ACTIONS.filter((action) => ownership.get(action) !== 1), []);
	});

	it('keeps every capacity handler focused, typed, and free of duplicate top-level helpers', async () => {
		const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
		const handlerDirectory = resolve(packageRoot, 'src/cli/handlers');
		const files = (await readdir(handlerDirectory))
			.filter((file) => /^capacity(?:-.*)?\.ts$/u.test(file))
			.sort();
		const helperOwners = new Map<string, string[]>();
		for (const file of files) {
			const source = await readFile(resolve(handlerDirectory, file), 'utf8');
			const lineCount = source.split(/\r?\n/u).length;
			assert.ok(lineCount <= 500, `${file} has ${lineCount} lines; capacity production modules may not exceed 500`);
			assert.doesNotMatch(source, /@ts-(?:nocheck|ignore|expect-error)|eslint-disable/u, `${file} contains a forbidden compiler or lint suppression`);
			for (const match of source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gmu)) {
				const helper = match[1]!;
				helperOwners.set(helper, [...(helperOwners.get(helper) ?? []), file]);
			}
		}
		const duplicates = [...helperOwners]
			.filter(([, owners]) => owners.length > 1)
			.map(([helper, owners]) => ({ helper, owners }));
		assert.deepEqual(duplicates, []);
	});
});
