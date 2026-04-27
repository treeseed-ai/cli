import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

type SavePlanRepo = {
	name: string;
	relativePath?: string;
	kind?: string;
	currentBranch?: string | null;
	targetBranch?: string;
	branchMode?: string;
	dirty?: boolean;
	currentVersion?: string | null;
	plannedVersion?: string | null;
	plannedTag?: string | null;
	plannedDependencySpec?: string | null;
	dependencies?: string[];
	commands?: string[];
	notes?: string[];
};

type SavePlanWave = {
	index: number;
	parallel: boolean;
	repos: string[];
	commands: Array<{
		repo: string;
		commands: string[];
	}>;
};

function formatRepoPlanSummary(repo: SavePlanRepo) {
	const branch = repo.currentBranch && repo.targetBranch && repo.currentBranch !== repo.targetBranch
		? `${repo.currentBranch} -> ${repo.targetBranch}`
		: repo.targetBranch ?? repo.currentBranch ?? 'unknown';
	const version = repo.plannedVersion
		? `, version ${repo.currentVersion ?? '?'} -> ${repo.plannedVersion}`
		: repo.currentVersion ? `, version ${repo.currentVersion}` : '';
	return `${repo.name} (${repo.kind ?? 'repo'}, ${repo.branchMode ?? 'unknown'}, ${repo.dirty ? 'dirty' : 'clean'}, branch ${branch}${version})`;
}

function formatSavePlanSections(repositoryPlan: {
	repos?: SavePlanRepo[];
	rootRepo?: SavePlanRepo;
	waves?: SavePlanWave[];
	plannedVersions?: Record<string, string>;
} | undefined) {
	if (!repositoryPlan) return [];
	const reposByName = new Map([
		...(repositoryPlan.repos ?? []),
		...(repositoryPlan.rootRepo ? [repositoryPlan.rootRepo] : []),
	].map((repo) => [repo.name, repo]));
	const sections = [];
	const repoLines = [
		...(repositoryPlan.repos ?? []).map((repo) => `- ${formatRepoPlanSummary(repo)}`),
		...(repositoryPlan.rootRepo ? [`- ${formatRepoPlanSummary(repositoryPlan.rootRepo)}`] : []),
	];
	if (repoLines.length > 0) {
		sections.push({ title: 'Repositories', lines: repoLines });
	}
	const versionEntries = Object.entries(repositoryPlan.plannedVersions ?? {});
	if (versionEntries.length > 0) {
		sections.push({
			title: 'Planned package versions',
			lines: versionEntries.map(([name, version]) => `- ${name}: ${version}`),
		});
	}
	const waveLines = [];
	for (const wave of repositoryPlan.waves ?? []) {
		waveLines.push(`Wave ${wave.index}${wave.parallel ? ' (parallel, concurrency 3)' : ''}: ${wave.repos.join(', ')}`);
		for (const entry of wave.commands) {
			const repo = reposByName.get(entry.repo);
			waveLines.push(`  ${entry.repo}${repo?.plannedDependencySpec ? ` -> ${repo.plannedDependencySpec}` : ''}`);
			entry.commands.forEach((command, index) => {
				waveLines.push(`    ${index + 1}. ${command}`);
			});
		}
	}
	if (waveLines.length > 0) {
		sections.push({ title: 'Execution order', lines: waveLines });
	}
	return sections;
}

export const handleSave: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context, {
			write: context.outputFormat === 'json' ? (() => {}) : context.write,
		}).save({
			message: invocation.positionals.join(' ').trim(),
			hotfix: invocation.args.hotfix === true,
			preview: invocation.args.preview === true,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			branch: string;
			scope: string;
			hotfix: boolean;
			message: string;
			resumed?: boolean;
			resumedRunId?: string | null;
			autoResumeCandidate?: { runId?: string | null } | null;
			commitSha?: string | null;
			commitCreated?: boolean;
			noChanges?: boolean;
			repos?: Array<{
				name: string;
				commitSha?: string | null;
				committed?: boolean;
				pushed?: boolean;
				skippedReason?: string | null;
			}>;
			rootRepo?: {
				committed?: boolean;
				pushed?: boolean;
			};
			repositoryPlan?: {
				repos?: SavePlanRepo[];
				rootRepo?: SavePlanRepo;
				waves?: SavePlanWave[];
				plannedVersions?: Record<string, string>;
			};
			previewAction?: { status: string };
		};
		const commitSha = typeof payload.commitSha === 'string' && payload.commitSha.length > 0
			? payload.commitSha.slice(0, 12)
			: 'not applicable';
		const savedRepos = (payload.repos ?? [])
			.filter((repo) => repo.committed || repo.pushed)
			.map((repo) => `${repo.name}@${String(repo.commitSha ?? '').slice(0, 12)}`)
			.join(', ');
		const plannedRepos = result.executionMode === 'plan'
			? (payload.repositoryPlan?.repos ?? payload.repos ?? []).map((repo) => repo.name).join(', ')
			: '';
		return guidedResult({
			command: invocation.commandName || 'save',
			summary: result.executionMode === 'plan'
				? 'Treeseed save plan ready.'
				: payload.noChanges ? 'Treeseed save found no new changes and confirmed branch sync.' : 'Treeseed save completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Branch', value: payload.branch },
				{ label: 'Environment scope', value: payload.scope },
				{ label: 'Hotfix', value: payload.hotfix ? 'yes' : 'no' },
				{
					label: result.executionMode === 'plan' ? 'Interrupted save' : 'Resumed run',
					value: result.executionMode === 'plan'
						? payload.autoResumeCandidate?.runId ? `will resume ${payload.autoResumeCandidate.runId}` : 'none'
						: payload.resumedRunId ?? 'none',
				},
				{ label: 'Commit', value: commitSha },
				{ label: 'Commit created', value: payload.commitCreated ? 'yes' : 'no' },
				{
					label: result.executionMode === 'plan' ? 'Workspace repos planned' : 'Workspace repos',
					value: result.executionMode === 'plan'
						? (plannedRepos || 'not applicable')
						: savedRepos || ((payload.repos ?? []).length > 0 ? 'none saved' : 'not applicable'),
				},
				{ label: 'Market pushed', value: payload.rootRepo?.pushed ? 'yes' : 'no' },
				{ label: 'Preview action', value: payload.previewAction?.status ?? 'skipped' },
			],
			sections: result.executionMode === 'plan' ? formatSavePlanSections(payload.repositoryPlan) : [],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
