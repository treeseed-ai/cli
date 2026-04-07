import { spawnSync } from 'node:child_process';
import { packageScriptPath } from './package-tools.ts';
import { applyTreeseedEnvironmentToProcess, assertTreeseedCommandEnvironment } from './config-runtime-lib.ts';
import { collectCliPreflight } from './workspace-preflight-lib.ts';
import { getGitHubAutomationMode, requiredGitHubEnvironment } from './github-automation-lib.ts';

function runStep(label, scriptName, { cwd, env } = {}) {
	const result = spawnSync(process.execPath, [packageScriptPath(scriptName)], {
		cwd,
		env: { ...process.env, ...(env ?? {}) },
		stdio: 'inherit',
	});

	if (result.status !== 0) {
		const error = new Error(`${label} failed.`);
		error.kind = `${label}_failed`;
		error.exitCode = result.status ?? 1;
		throw error;
	}
}

function missingRequiredEnv(requiredKeys) {
	return requiredKeys.filter((key) => {
		const value = process.env[key];
		return typeof value !== 'string' || value.length === 0;
	});
}

export function validateSaveAutomationPrerequisites({ cwd }) {
	applyTreeseedEnvironmentToProcess({ tenantRoot: cwd, scope: 'prod' });
	assertTreeseedCommandEnvironment({ tenantRoot: cwd, scope: 'prod', purpose: 'save' });

	if (getGitHubAutomationMode() !== 'real') {
		return {
			ok: true,
			mode: 'stub',
			missingEnv: [],
			preflight: null,
		};
	}

	const preflight = collectCliPreflight({ cwd, requireAuth: true });
	if (!preflight.ok) {
		const error = new Error('Treeseed save prerequisites failed: GitHub/Wrangler auth is not ready.');
		error.kind = 'auth_failed';
		error.details = preflight;
		throw error;
	}

	const required = requiredGitHubEnvironment(cwd, { scope: 'prod', purpose: 'save' });
	const missingEnv = missingRequiredEnv([...required.secrets, ...required.variables]);
	if (missingEnv.length > 0) {
		const error = new Error(
			`Treeseed save is missing required environment variables: ${missingEnv.join(', ')}.`,
		);
		error.kind = 'missing_required_env';
		error.missingEnv = missingEnv;
		throw error;
	}

	return {
		ok: true,
		mode: 'real',
		missingEnv: [],
		preflight,
	};
}

export function runWorkspaceSavePreflight({ cwd }) {
	runStep('lint', 'workspace-lint', { cwd });
	runStep('test', 'workspace-test', { cwd });
	runStep('build', 'tenant-build', { cwd });
}

export function runTenantDeployPreflight({ cwd, scope = 'prod' }) {
	applyTreeseedEnvironmentToProcess({ tenantRoot: cwd, scope });
	assertTreeseedCommandEnvironment({ tenantRoot: cwd, scope, purpose: 'deploy' });
	runStep('lint', 'tenant-lint', { cwd });
	runStep('test', 'tenant-test', { cwd });
	runStep('build', 'tenant-build', { cwd });
}
