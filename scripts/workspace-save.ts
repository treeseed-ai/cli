#!/usr/bin/env node

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyTreeseedEnvironmentToProcess } from './config-runtime-lib.ts';
import {
	collectMergeConflictReport,
	currentBranch,
	formatMergeConflictReport,
	hasMeaningfulChanges,
	originRemoteUrl,
	repoRoot,
} from './workspace-save-lib.ts';
import { remoteBranchExists, STAGING_BRANCH, PRODUCTION_BRANCH } from './git-workflow-lib.ts';
import { run, workspaceRoot } from './workspace-tools.ts';
import { runWorkspaceSavePreflight } from './save-deploy-preflight-lib.ts';

function writeSaveReport(payload) {
	const target = process.env.TREESEED_SAVE_REPORT_PATH;
	if (!target) {
		return;
	}

	const filePath = resolve(target);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
	const parsed = {
		hotfix: false,
		messageParts: [],
	};

	for (const current of argv) {
		if (current === '--hotfix') {
			parsed.hotfix = true;
			continue;
		}
		parsed.messageParts.push(current);
	}

	return {
		hotfix: parsed.hotfix,
		message: parsed.messageParts.join(' ').trim(),
	};
}

const options = parseArgs(process.argv.slice(2));
const message = options.message;
const root = workspaceRoot();
const gitRoot = repoRoot(root);
const branch = currentBranch(gitRoot);
const scope = branch === STAGING_BRANCH ? 'staging' : branch === PRODUCTION_BRANCH ? 'prod' : 'local';
applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope });

if (!message) {
	writeSaveReport({ ok: false, kind: 'usage', message: 'Treeseed save requires a commit message.' });
	console.error('Treeseed save requires a commit message. Usage: treeseed save <message>');
	process.exit(1);
}

if (!branch) {
	writeSaveReport({ ok: false, kind: 'missing_branch', message: 'Treeseed save requires an active git branch.' });
	console.error('Treeseed save requires an active git branch.');
	process.exit(1);
}

if (branch === PRODUCTION_BRANCH && !options.hotfix) {
	writeSaveReport({
		ok: false,
		kind: 'protected_branch',
		branch,
		message: 'Treeseed save is blocked on main. Use `treeseed release` for normal production promotion or `treeseed save --hotfix` for an explicit hotfix.',
	});
	console.error('Treeseed save is blocked on main. Use `treeseed release` for normal production promotion or `treeseed save --hotfix` for an explicit hotfix.');
	process.exit(1);
}

try {
	originRemoteUrl(gitRoot);
} catch {
	writeSaveReport({ ok: false, kind: 'missing_origin', message: 'Treeseed save requires an origin remote.' });
	console.error('Treeseed save requires an origin remote.');
	process.exit(1);
}

try {
	runWorkspaceSavePreflight({ cwd: root });
} catch (error) {
	const kind = error?.kind ?? 'preflight_failed';
	writeSaveReport({
		ok: false,
		kind,
		message: error instanceof Error ? error.message : String(error),
	});
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(error?.exitCode ?? 1);
}

if (!hasMeaningfulChanges(gitRoot)) {
	writeSaveReport({ ok: false, kind: 'no_changes', message: 'Treeseed save found no meaningful repository changes to commit.' });
	console.error('Treeseed save found no meaningful repository changes to commit.');
	process.exit(1);
}

run('git', ['add', '-A'], { cwd: gitRoot });
run('git', ['commit', '-m', message], { cwd: gitRoot });

try {
	if (remoteBranchExists(gitRoot, branch)) {
		run('git', ['pull', '--rebase', 'origin', branch], { cwd: gitRoot });
		run('git', ['push', 'origin', branch], { cwd: gitRoot });
	} else {
		run('git', ['push', '-u', 'origin', branch], { cwd: gitRoot });
	}
} catch (error) {
	const report = collectMergeConflictReport(gitRoot);
	writeSaveReport({
		ok: false,
		kind: 'merge_conflict',
		branch,
		report,
		formatted: formatMergeConflictReport(report, gitRoot, branch),
	});
	console.error(formatMergeConflictReport(report, gitRoot, branch));
	process.exit(12);
}

const summary = {
	ok: true,
	kind: 'success',
	message,
	branch,
	scope,
	hotfix: options.hotfix,
	root,
	repositoryRoot: gitRoot,
};
writeSaveReport(summary);

console.log('Treeseed save completed successfully.');
console.log(`Branch: ${branch}`);
console.log(`Environment scope: ${scope}`);
