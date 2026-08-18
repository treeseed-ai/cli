import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlatformWorksetInventoryRepository } from '@treeseed/sdk';
import type { MarketClient } from '@treeseed/sdk/market-client';
import { parse } from 'yaml';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function matchesTeam(value: JsonRecord, selector: string) {
	const expected = selector.toLowerCase();
	return [value.id, value.slug, value.name, value.teamId, value.teamSlug]
		.some((candidate) => typeof candidate === 'string' && candidate.toLowerCase() === expected);
}

async function resolveTeamId(client: MarketClient, selector: string) {
	const profile = await client.request<{ payload?: JsonRecord }>(`/v1/teams/by-name/${encodeURIComponent(selector)}/profile`, { requireAuth: true }).catch(() => null);
	const team = record(record(profile?.payload).team);
	const direct = text(team.id);
	if (direct) return direct;
	const identity = await client.request<{ payload?: JsonRecord }>('/v1/me', { requireAuth: true });
	const payload = record(identity.payload);
	const teams = Array.isArray(payload.teams) ? payload.teams.map(record) : [];
	const resolved = teams.find((candidate) => matchesTeam(candidate, selector));
	return text(resolved?.id) ?? text(resolved?.teamId) ?? selector;
}

function materializableRepository(project: JsonRecord, repository: JsonRecord): PlatformWorksetInventoryRepository | null {
	const role = text(repository.role);
	if (role !== 'primary' && role !== 'fixture') return null;
	const owner = text(repository.owner);
	const name = text(repository.name);
	if (!owner || !name || /^(market|market-api)$/u.test(name)) return null;
	const metadata = record(project.metadata);
	const configured = record(metadata.repository);
	const policy = record(configured.repositoryPolicy);
	const path = text(repository.submodulePath) ?? text(configured.checkoutPath);
	if (!path || name === 'platform') return null;
	const branch = role === 'primary'
		? text(repository.currentBranch) ?? text(policy.stagingBranch) ?? text(repository.defaultBranch)
		: text(repository.currentBranch) ?? text(repository.defaultBranch);
	if (!branch) throw new Error(`Team inventory repository ${owner}/${name} has no observable branch.`);
	return {
		projectId: String(project.id),
		role,
		path,
		repository: `${owner}/${name}`,
		branch,
	};
}

export async function loadPlatformWorksetInventory(client: MarketClient, teamSelector: string) {
	const teamId = await resolveTeamId(client, teamSelector);
	const response = await client.request<{ payload?: { teamId?: string; projects?: JsonRecord[] } }>(`/v1/teams/${encodeURIComponent(teamId)}/project-inventory`, { requireAuth: true });
	const projects = Array.isArray(response.payload?.projects) ? response.payload.projects : [];
	const inventory = projects.flatMap((project) => {
		const repositories = Array.isArray(project.repositories) ? project.repositories.map(record) : [];
		return repositories.map((repository) => materializableRepository(project, repository)).filter((entry): entry is PlatformWorksetInventoryRepository => Boolean(entry));
	});
	return { teamId: response.payload?.teamId ?? teamId, inventory };
}

function localRepository(projectId: string, repository: JsonRecord): PlatformWorksetInventoryRepository | null {
	const role = text(repository.role);
	if (role !== 'primary' && role !== 'fixture') return null;
	const owner = text(repository.owner);
	const name = text(repository.name);
	if (!owner || !name || /^(market|market-api)$/u.test(name) || name.endsWith('-content') || name === 'platform') return null;
	const path = text(repository.submodulePath) ?? text(repository.checkoutPath);
	const policy = record(repository.repositoryPolicy);
	const branch = text(repository.currentBranch) ?? text(policy.stagingBranch) ?? text(repository.defaultBranch);
	if (!path || !branch) throw new Error(`Local Platform inventory repository ${owner}/${name} is missing a checkout path or branch.`);
	return { projectId, role, path, repository: `${owner}/${name}`, branch };
}

function localTeamId(resources: JsonRecord, selector: string) {
	const teams = Array.isArray(resources.teams) ? resources.teams.map(record) : [];
	const team = teams.find((candidate) => matchesTeam(candidate, selector)
		|| text(candidate.key)?.toLowerCase() === `team:${selector.toLowerCase()}`);
	if (!team) throw new Error(`Local Platform inventory does not declare team ${selector}.`);
	return text(team.key) ?? text(team.id) ?? text(team.slug) ?? selector;
}

export function loadLocalPlatformWorksetInventory(root: string, teamSelector: string, seedPath = 'seeds/treeseed.yaml') {
	const document = record(parse(readFileSync(resolve(root, seedPath), 'utf8')));
	const resources = record(document.resources);
	const teamId = localTeamId(resources, teamSelector);
	const projects = Array.isArray(resources.projects) ? resources.projects.map(record) : [];
	const projectRepositories = projects.map((project) => {
		const projectId = text(project.key) ?? text(project.id) ?? text(project.slug);
		if (!projectId) throw new Error('Local Platform inventory contains a project without an identity.');
		return localRepository(projectId, record(project.repository));
	});
	const supportRepositories = (Array.isArray(resources.hubRepositories) ? resources.hubRepositories.map(record) : [])
		.map((repository) => {
			const projectId = text(repository.project);
			if (!projectId) throw new Error('Local Platform inventory contains a support repository without a project identity.');
			return localRepository(projectId, repository);
		});
	return {
		teamId,
		inventory: [...projectRepositories, ...supportRepositories]
			.filter((entry): entry is PlatformWorksetInventoryRepository => Boolean(entry)),
		inventorySource: 'local-seed' as const,
		seedPath,
	};
}
