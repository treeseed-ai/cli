import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyArtifactBytes } from '@treeseed/sdk/market-client';
import type { CommandHandler } from '../../types.js';
import { guidedResult } from '../utilities/utils.js';
import { createMarketClientForInvocation } from './market-utils.js';

const stringArg = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const listArg = (value: unknown) => stringArg(value).split(',').map((item) => item.trim()).filter(Boolean);

function requiredArg(value: unknown, message: string) {
	const result = stringArg(value);
	if (!result) throw new Error(message);
	return result;
}

export const handlePacks: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'list';
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const teamId = stringArg(invocation.args.team);
	if (action === 'list') {
		const team = requiredArg(teamId, 'Use --team <team-id> to list immutable knowledge-pack builds.');
		const response = await client.request<any>(`/v1/teams/${encodeURIComponent(team)}/knowledge/packs`, { requireAuth: true });
		const builds = response.payload ?? response;
		return guidedResult({ command: 'packs', summary: 'Repository-native knowledge-pack builds', sections: [{ title: 'Packs',
			lines: builds.map((build: any) => `${build.id}  ${build.status}  books=${build.bookIds?.length ?? 0}  created=${build.createdAt}`) }],
			report: { marketId: profile.id, teamId: team, builds } });
	}
	if (action === 'build') {
		const team = requiredArg(teamId, 'Use --team <team-id> to build a knowledge pack.');
		const collectionId = stringArg(invocation.args.collection);
		const bookIds = listArg(invocation.args.books);
		if (!collectionId && !bookIds.length) throw new Error('Use --collection <collection-id> or --books <book-id,...>.');
		const response = await client.request<any>(`/v1/teams/${encodeURIComponent(team)}/knowledge/packs`, {
			method: 'POST', requireAuth: true, body: collectionId ? { collectionId } : { bookIds },
		});
		const payload = response.payload ?? response;
		return guidedResult({ command: 'packs', summary: 'Knowledge-pack build queued.', facts: [
			{ label: 'Build', value: payload.build?.id }, { label: 'Operation', value: payload.operation?.id },
		], report: { marketId: profile.id, teamId: team, ...payload } });
	}
	if (action === 'status' || action === 'download') {
		const buildId = requiredArg(invocation.positionals[1], `Usage: treeseed packs ${action} <build-id>`);
		const response = await client.request<any>(`/v1/knowledge/packs/${encodeURIComponent(buildId)}`, { requireAuth: true });
		const build = response.payload ?? response;
		if (action === 'status') return guidedResult({ command: 'packs', summary: `Knowledge-pack build ${build.status}.`,
			report: { marketId: profile.id, build } });
		if (build.status !== 'completed') throw new Error(`Knowledge-pack build is ${build.status}, not completed.`);
		const headers: Record<string, string> = { accept: 'application/zip' };
		if (client.accessToken) headers.authorization = `Bearer ${client.accessToken}`;
		const download = await client.fetchImpl(`${client.baseUrl}/v1/knowledge/packs/${encodeURIComponent(buildId)}/download`, { headers });
		if (!download.ok) throw new Error(`Knowledge-pack download failed with status ${download.status}.`);
		const bytes = await verifyArtifactBytes(download, build.artifact?.digest);
		const outputDir = resolve(context.cwd, stringArg(invocation.args.output) || '.treeseed/downloads');
		mkdirSync(outputDir, { recursive: true });
		const fileName = String(build.artifact?.fileName ?? `knowledge-pack-${buildId}.zip`).replace(/[^A-Za-z0-9._-]+/gu, '-');
		const outputPath = resolve(outputDir, fileName);
		writeFileSync(outputPath, bytes);
		return guidedResult({ command: 'packs', summary: 'Downloaded immutable knowledge pack.', facts: [
			{ label: 'Build', value: buildId }, { label: 'Path', value: outputPath }, { label: 'Digest', value: build.artifact?.digest },
		], report: { marketId: profile.id, buildId, outputPath, digest: build.artifact?.digest } });
	}
	return { exitCode: 1, stderr: [`Unknown packs action: ${action}`] };
};
