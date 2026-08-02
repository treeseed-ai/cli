import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { capacityWorkdayAgentClassId } from '../../../src/cli/handlers/capacity/workdays/configuration/capacity-workday-agent-class.ts';
import { ensureCapacityWorkdayAgentClasses, readCapacityWorkdayAgentSpecs } from '../../../src/cli/handlers/capacity/workdays/configuration/capacity-workday-projects.ts';

describe('capacity workday project-agent-class identity', () => {
	it('scopes reusable configured class ids to their owning project', () => {
		assert.equal(capacityWorkdayAgentClassId('project-a', 'architecture'), 'project-a:architecture');
		assert.equal(capacityWorkdayAgentClassId('project-b', 'architecture'), 'project-b:architecture');
		assert.notEqual(capacityWorkdayAgentClassId('project-a', 'architecture'), capacityWorkdayAgentClassId('project-b', 'architecture'));
	});

	it('is stable when an already-scoped id is synchronized again', () => {
		assert.equal(capacityWorkdayAgentClassId('project-a', 'project-a:architecture'), 'project-a:architecture');
	});

	it('discovers enabled agent definitions in semantic subdirectories', async () => {
		const root = await mkdtemp(join(tmpdir(), 'treeseed-agent-discovery-'));
		try {
			await mkdir(join(root, 'src/content/agents/editorial'), { recursive: true });
			await writeFile(join(root, 'src/content/agents/engineer.mdx'), '---\nslug: engineer\nenabled: false\nruntimeStatus: dormant\n---\n');
			await writeFile(join(root, 'src/content/agents/editorial/guide-writer.mdx'), `---
slug: guide-writer
projectAgentClassId: guide-writing
projectAgentClassSlug: guide-writing
enabled: true
activityProfiles:
  planning:
    activityType: planning
    enabled: true
    handler: writer
---
`);
			const specs = await readCapacityWorkdayAgentSpecs({ cwd: root } as never, 'market');
			assert.deepEqual(specs.map((spec) => spec.slug), ['guide-writer']);
			assert.match(specs[0]!.contentPath, /agents\/editorial\/guide-writer\.mdx$/u);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('pauses content-synced classes whose source agent is disabled', async () => {
		const root = await mkdtemp(join(tmpdir(), 'treeseed-agent-sync-'));
		try {
			await mkdir(join(root, 'src/content/agents'), { recursive: true });
			const updates: Array<{ id: string; body: Record<string, unknown> }> = [];
			const existing = {
				id: 'project-a:engineering', slug: 'engineering', status: 'active',
				metadata: { source: 'project_agent_content_sync' },
			};
			const client = {
				updateProjectAgentClass: async (_projectId: string, id: string, body: Record<string, unknown>) => {
					updates.push({ id, body });
					return { payload: body };
				},
			};
			await ensureCapacityWorkdayAgentClasses(client as never, { cwd: root } as never, 'project-a', 'market', [existing], 'sync');
			assert.equal(updates.length, 1);
			assert.equal(updates[0]!.id, existing.id);
			assert.equal(updates[0]!.body.status, 'paused');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
