import { capacityRecord as record, firstCapacityString as text } from './capacity-values.js';

/**
 * Extracts verified TreeDX repository identities from both reconciliation
 * update results and no-op verification results. Live verification is the
 * authoritative fallback; desired repository names are never treated as ids.
 */
export function treeDxRepositoryIdsFromReconcileResults(results: unknown): Record<string, string> {
	const repositoryIdsBySlug: Record<string, string> = {};
	if (!Array.isArray(results)) return repositoryIdsBySlug;
	for (const item of results) {
		const entry = record(item);
		const syncedProjects = record(entry.state).syncedProjects;
		if (Array.isArray(syncedProjects)) {
			for (const item of syncedProjects) {
				const project = record(item);
				const slug = text(project.project, project.slug);
				const repositoryId = text(project.repositoryId, project.repoId, project.id);
				if (slug && repositoryId) repositoryIdsBySlug[slug] = repositoryId;
			}
		}
		const checks = record(entry.verification).checks;
		if (!Array.isArray(checks)) continue;
		for (const item of checks) {
			const check = record(item);
			const key = text(check.key);
			if (!key.startsWith('treedx-repo:') || check.verified !== true) continue;
			const slug = key.slice('treedx-repo:'.length);
			const observed = record(check.observed);
			const repositoryId = text(observed.repoId, observed.repositoryId, observed.id);
			if (slug && repositoryId) repositoryIdsBySlug[slug] = repositoryId;
		}
	}
	return repositoryIdsBySlug;
}
