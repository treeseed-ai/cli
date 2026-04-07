import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createTempDir } from './workspace-tools.ts';

function runCapture(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: options.timeoutMs,
	});

	return {
		status: result.status ?? 1,
		signal: result.signal ?? null,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		error: result.error?.message ?? null,
	};
}

function locateBinary(candidate) {
	const result = runCapture('bash', ['-lc', `command -v ${candidate}`]);
	return result.status === 0 ? result.stdout.trim() : null;
}

export function createWranglerCommandEnv(overrides = {}) {
	const configHome = createTempDir('treeseed-wrangler-config-');
	const logDir = resolve(configHome, '.wrangler', 'logs');
	mkdirSync(logDir, { recursive: true });
	return {
		XDG_CONFIG_HOME: configHome,
		WRANGLER_SEND_METRICS: 'false',
		...overrides,
	};
}

export function parseGitHubAuthStatus(output, status) {
	return {
		authenticated: status === 0 && /Logged in|Active account:/i.test(output),
		detail: output.trim(),
	};
}

export function parseWranglerWhoAmI(output, status) {
	return {
		authenticated: status === 0 && !/error|failed/i.test(output),
		detail: output.trim(),
	};
}

export function parseCopilotSessionStatus(output, status) {
	const normalized = output.trim();
	return {
		configured: status === 0 || /copilot_github_token|github_token|gh_token/i.test(normalized),
		detail: normalized,
	};
}

function copilotSessionProbe() {
	const configDir = process.env.COPILOT_CONFIG_DIR
		? resolve(process.env.COPILOT_CONFIG_DIR)
		: resolve(process.env.HOME ?? tmpdir(), '.copilot');
	const authPath = resolve(configDir, 'auth.json');
	const envConfigured = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'].some((key) => {
		const value = process.env[key];
		return typeof value === 'string' && value.length > 0;
	});

	if (envConfigured) {
		return {
			status: 0,
			output: 'Copilot token environment variable detected.',
		};
	}

	if (!existsSync(authPath)) {
		return {
			status: 1,
			output: `No Copilot token environment variable detected and ${authPath} was not found.`,
		};
	}

	try {
		const contents = readFileSync(authPath, 'utf8');
		if (contents.trim().length === 0) {
			return {
				status: 1,
				output: `${authPath} is empty.`,
			};
		}
		return {
			status: 0,
			output: `Copilot auth configuration detected at ${authPath}.`,
		};
	} catch (error) {
		return {
			status: 1,
			output: error instanceof Error ? error.message : String(error),
		};
	}
}

export function collectCliPreflight({ cwd = process.cwd(), requireAuth = false } = {}) {
	const binaries = {
		git: locateBinary('git'),
		npm: locateBinary('npm'),
		gh: locateBinary('gh'),
		wrangler: locateBinary('wrangler'),
		copilot: locateBinary('copilot'),
	};

	const checks = {
		commands: Object.fromEntries(
			Object.entries(binaries).map(([name, path]) => [name, {
				installed: Boolean(path),
				path,
			}]),
		),
		auth: {},
	};

	if (binaries.gh) {
		const result = runCapture('gh', ['auth', 'status'], { cwd });
		checks.auth.gh = parseGitHubAuthStatus(`${result.stdout}\n${result.stderr}`.trim(), result.status);
	} else {
		checks.auth.gh = { authenticated: false, detail: 'GitHub CLI is not installed.' };
	}

	if (binaries.wrangler) {
		const env = createWranglerCommandEnv();
		const result = runCapture('wrangler', ['whoami'], { cwd, env, timeoutMs: 60000 });
		checks.auth.wrangler = parseWranglerWhoAmI(`${result.stdout}\n${result.stderr}`.trim(), result.status);
	} else {
		checks.auth.wrangler = { authenticated: false, detail: 'Wrangler CLI is not installed.' };
	}

	if (binaries.copilot) {
		const probe = copilotSessionProbe();
		checks.auth.copilot = parseCopilotSessionStatus(probe.output, probe.status);
	} else {
		checks.auth.copilot = { configured: false, detail: 'Copilot CLI is not installed.' };
	}

	const missingCommands = Object.entries(checks.commands)
		.filter(([, value]) => !value.installed)
		.map(([name]) => name);
	const failingAuth = [];

	if (requireAuth) {
		if (!checks.auth.gh?.authenticated) failingAuth.push('gh');
		if (!checks.auth.wrangler?.authenticated) failingAuth.push('wrangler');
	}

	return {
		ok: missingCommands.length === 0 && failingAuth.length === 0,
		requireAuth,
		missingCommands,
		failingAuth,
		checks,
	};
}

export function formatCliPreflightReport(report) {
	const lines = [
		'Treeseed preflight summary',
		`Status: ${report.ok ? 'ok' : 'failed'}`,
		`Require auth: ${report.requireAuth ? 'yes' : 'no'}`,
		'Commands:',
	];

	for (const [name, info] of Object.entries(report.checks.commands)) {
		lines.push(`- ${name}: ${info.installed ? `installed (${info.path})` : 'missing'}`);
	}

	lines.push('Auth/session:');
	lines.push(`- gh: ${report.checks.auth.gh?.authenticated ? 'authenticated' : 'not authenticated'}`);
	lines.push(`  ${report.checks.auth.gh?.detail ?? ''}`.trimEnd());
	lines.push(`- wrangler: ${report.checks.auth.wrangler?.authenticated ? 'authenticated' : 'not authenticated'}`);
	lines.push(`  ${report.checks.auth.wrangler?.detail ?? ''}`.trimEnd());
	lines.push(`- copilot: ${report.checks.auth.copilot?.configured ? 'configured' : 'not configured'}`);
	lines.push(`  ${report.checks.auth.copilot?.detail ?? ''}`.trimEnd());

	if (report.missingCommands.length > 0) {
		lines.push(`Missing commands: ${report.missingCommands.join(', ')}`);
	}
	if (report.failingAuth.length > 0) {
		lines.push(`Auth failures: ${report.failingAuth.join(', ')}`);
	}

	return lines.filter(Boolean).join('\n');
}

export function writeJsonArtifact(filePath, value) {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
