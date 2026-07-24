import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { treeDxRepositoryIdsFromReconcileResults } from '../../../src/cli/handlers/capacity/workdays/configuration/capacity-workday-treedx.ts';

describe('capacity workday TreeDX reconciliation evidence', () => {
	it('reads repository ids from update state', () => {
		assert.deepEqual(treeDxRepositoryIdsFromReconcileResults([{
			state: { syncedProjects: [{ project: 'agent', repositoryId: 'repo-agent' }] },
		}]), { agent: 'repo-agent' });
	});

	it('reads authoritative repository ids from verified no-op checks', () => {
		assert.deepEqual(treeDxRepositoryIdsFromReconcileResults([{
			state: { registeredRepositoryNames: ['treeseed-agent'] },
			verification: { checks: [{ key: 'treedx-repo:agent', verified: true, observed: { repoId: 'repo-agent-live', repositoryName: 'treeseed-agent' } }] },
		}]), { agent: 'repo-agent-live' });
	});

	it('does not accept unverified desired names as repository ids', () => {
		assert.deepEqual(treeDxRepositoryIdsFromReconcileResults([{
			state: { registeredRepositoryNames: ['treeseed-agent'] },
			verification: { checks: [{ key: 'treedx-repo:agent', verified: false, observed: { repositoryName: 'treeseed-agent' } }] },
		}]), {});
	});
});
