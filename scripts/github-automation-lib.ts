import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTreeseedEnvironmentRegistry } from '@treeseed/core/environment';
import { corePackageRoot, loadCliDeployConfig } from './package-tools.ts';

function envOrNull(key) {
	const value = process.env[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

export function getGitHubAutomationMode() {
	return process.env.TREESEED_GITHUB_AUTOMATION_MODE === 'stub' ? 'stub' : 'real';
}

function isGitHubAutomationStubbed() {
	return getGitHubAutomationMode() === 'stub';
}

export function parseGitHubRepositoryFromRemote(remoteUrl) {
	if (!remoteUrl) {
		return null;
	}

	const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return `${sshMatch[1]}/${sshMatch[2]}`;
	}

	const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
	if (httpsMatch) {
		return `${httpsMatch[1]}/${httpsMatch[2]}`;
	}

	return null;
}

function runGit(args, { cwd, allowFailure = false, capture = true } = {}) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
	});

	if (result.status !== 0 && !allowFailure) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}

	return result;
}

function runGh(args, { cwd, allowFailure = false, capture = true, input } = {}) {
	const result = spawnSync('gh', args, {
		cwd,
		stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
		encoding: 'utf8',
		input,
	});

	if (result.error && result.error.code === 'ENOENT') {
		throw new Error('GitHub CLI `gh` is required for Treeseed GitHub automation.');
	}

	if (result.status !== 0 && !allowFailure) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `gh ${args.join(' ')} failed`);
	}

	return result;
}

export function resolveGitHubRepositorySlug(tenantRoot) {
	const remoteResult = runGit(['remote', 'get-url', 'origin'], { cwd: tenantRoot });
	const remoteUrl = remoteResult.stdout?.trim() ?? '';
	const repository = parseGitHubRepositoryFromRemote(remoteUrl);
	if (!repository) {
		throw new Error(`Unable to determine GitHub repository from origin remote "${remoteUrl}".`);
	}
	return repository;
}

export function maybeResolveGitHubRepositorySlug(tenantRoot) {
	try {
		return resolveGitHubRepositorySlug(tenantRoot);
	} catch {
		return null;
	}
}

export function resolveGitRepositoryRoot(tenantRoot) {
	const result = runGit(['rev-parse', '--show-toplevel'], { cwd: tenantRoot, allowFailure: true });
	return result.status === 0 ? result.stdout.trim() : tenantRoot;
}

export function requiredGitHubEnvironment(tenantRoot, { scope = 'prod', purpose = 'save' } = {}) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const registry = resolveTreeseedEnvironmentRegistry({ deployConfig });
	const relevant = registry.entries.filter(
		(entry) =>
			entry.scopes.includes(scope)
			&& entry.purposes.includes(purpose)
			&& (!entry.isRelevant || entry.isRelevant(registry.context, scope, purpose)),
	);

	return {
		secrets: [...new Set(relevant.filter((entry) => entry.targets.includes('github-secret')).map((entry) => entry.id))],
		variables: [...new Set(relevant.filter((entry) => entry.targets.includes('github-variable')).map((entry) => entry.id))],
	};
}

export function requiredGitHubSecrets(tenantRoot) {
	return requiredGitHubEnvironment(tenantRoot).secrets;
}

export function renderDeployWorkflow({ workingDirectory }) {
	const normalizedWorkingDirectory = workingDirectory && workingDirectory !== '.' ? workingDirectory : '.';
	const workingDirectoryLine = normalizedWorkingDirectory === '.'
		? ''
		: `    defaults:\n      run:\n        working-directory: ${normalizedWorkingDirectory}\n`;
	const templatePath = resolve(corePackageRoot, 'templates', 'github', 'deploy.workflow.yml');
	const template = readFileSync(templatePath, 'utf8');

	return template
		.replace('__WORKING_DIRECTORY_BLOCK__', workingDirectoryLine)
		.replace(
			'__CACHE_DEPENDENCY_PATH__',
			normalizedWorkingDirectory === '.' ? 'package-lock.json' : `${normalizedWorkingDirectory}/package-lock.json`,
		);
}

export function ensureDeployWorkflow(tenantRoot) {
	if (isGitHubAutomationStubbed()) {
		return {
			workflowPath: resolve(tenantRoot, '.github', 'workflows', 'deploy.yml'),
			changed: false,
			workingDirectory: '.',
			mode: 'stub',
		};
	}

	const repositoryRoot = resolveGitRepositoryRoot(tenantRoot);
	const workflowPath = resolve(tenantRoot, '.github', 'workflows', 'deploy.yml');
	const workingDirectory = relative(repositoryRoot, tenantRoot).replaceAll('\\', '/') || '.';
	const expected = renderDeployWorkflow({ workingDirectory });
	const current = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : null;

	if (current === expected) {
		return { workflowPath, changed: false, workingDirectory };
	}

	mkdirSync(dirname(workflowPath), { recursive: true });
	writeFileSync(workflowPath, expected, 'utf8');
	return { workflowPath, changed: true, workingDirectory };
}

export function listGitHubSecretNames(repository, tenantRoot) {
	const result = runGh(['secret', 'list', '--repo', repository, '--json', 'name'], {
		cwd: tenantRoot,
	});
	return new Set(
		(JSON.parse(result.stdout || '[]'))
			.map((entry) => entry?.name)
			.filter((value) => typeof value === 'string' && value.length > 0),
	);
}

export function listGitHubVariableNames(repository, tenantRoot) {
	const result = runGh(['variable', 'list', '--repo', repository, '--json', 'name'], {
		cwd: tenantRoot,
	});
	return new Set(
		(JSON.parse(result.stdout || '[]'))
			.map((entry) => entry?.name)
			.filter((value) => typeof value === 'string' && value.length > 0),
	);
}

export function formatMissingSecretsReport(repository, missingSecrets, reason = 'missing_local_env') {
	const lines = [
		'Treeseed GitHub secret sync failed.',
		`Repository: ${repository}`,
		`Reason: ${reason}`,
		'Missing secrets:',
	];

	for (const secret of missingSecrets) {
		lines.push(`- ${secret.name}: localEnv=${secret.localEnvPresent ? 'present' : 'missing'} remote=${secret.remotePresent ? 'present' : 'missing'}`);
	}

	return lines.join('\n');
}

export function ensureGitHubSecrets(tenantRoot, { dryRun = false } = {}) {
	return ensureGitHubEnvironment(tenantRoot, { dryRun }).secrets;
}

export function ensureGitHubEnvironment(tenantRoot, { dryRun = false, scope = 'prod', purpose = 'save' } = {}) {
	if (isGitHubAutomationStubbed()) {
		return {
			repository: maybeResolveGitHubRepositorySlug(tenantRoot),
			secrets: {
				existing: [],
				created: [],
			},
			variables: {
				existing: [],
				created: [],
			},
			skipped: 'stubbed',
			mode: 'stub',
		};
	}

	const repository = maybeResolveGitHubRepositorySlug(tenantRoot);
	if (!repository) {
		if (dryRun) {
			return {
				repository: null,
				secrets: { existing: [], created: [] },
				variables: { existing: [], created: [] },
				skipped: 'missing_repository',
			};
		}
		throw new Error('Unable to determine GitHub repository from the current tenant. Configure an origin remote before syncing GitHub secrets.');
	}
	const required = requiredGitHubEnvironment(tenantRoot, { scope, purpose });
	const requiredSecrets = required.secrets;
	const requiredVariables = required.variables;
	const existingSecrets = listGitHubSecretNames(repository, tenantRoot);
	const existingVariables = listGitHubVariableNames(repository, tenantRoot);
	const missingRemote = requiredSecrets.filter((name) => !existingSecrets.has(name));
	const missingRemoteVariables = requiredVariables.filter((name) => !existingVariables.has(name));

	const missingLocal = missingRemote
		.filter((name) => !envOrNull(name))
		.map((name) => ({ name, localEnvPresent: false, remotePresent: false }));
	const missingLocalVariables = missingRemoteVariables
		.filter((name) => !envOrNull(name))
		.map((name) => ({ name, localEnvPresent: false, remotePresent: false }));

	if (missingLocal.length > 0 || missingLocalVariables.length > 0) {
		throw new Error(formatMissingSecretsReport(repository, [...missingLocal, ...missingLocalVariables]));
	}

	const createdSecrets = [];
	for (const name of missingRemote) {
		if (dryRun) {
			createdSecrets.push(name);
			continue;
		}
		runGh(['secret', 'set', name, '--repo', repository, '--body', envOrNull(name) ?? ''], {
			cwd: tenantRoot,
		});
		createdSecrets.push(name);
	}

	const createdVariables = [];
	for (const name of missingRemoteVariables) {
		if (dryRun) {
			createdVariables.push(name);
			continue;
		}
		runGh(['variable', 'set', name, '--repo', repository, '--body', envOrNull(name) ?? ''], {
			cwd: tenantRoot,
		});
		createdVariables.push(name);
	}

	return {
		repository,
		secrets: {
			existing: requiredSecrets.filter((name) => existingSecrets.has(name)),
			created: createdSecrets,
		},
		variables: {
			existing: requiredVariables.filter((name) => existingVariables.has(name)),
			created: createdVariables,
		},
	};
}

export function ensureGitHubDeployAutomation(tenantRoot, { dryRun = false } = {}) {
	const workflow = ensureDeployWorkflow(tenantRoot);
	const environment = ensureGitHubEnvironment(tenantRoot, { dryRun });
	return {
		mode: getGitHubAutomationMode(),
		workflow,
		secrets: environment.secrets,
		variables: environment.variables,
		environment,
	};
}
