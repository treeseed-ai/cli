import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	createDefaultMachineConfig,
	ensureGitignoreEntries,
	getMachineConfigPaths,
	loadCliDeployConfig,
	loadDeployState,
	loadMachineConfig,
	resolveMachineEnvironmentValues,
	warnDeprecatedLocalEnvFiles,
	writeMachineConfig,
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
} from '@treeseed/sdk/workflow-support';

export type RepairAction = {
	id: string;
	detail: string;
};

export function applySafeRepairs(tenantRoot: string): RepairAction[] {
	const actions: RepairAction[] = [];
	ensureGitignoreEntries(tenantRoot);
	actions.push({ id: 'gitignore', detail: 'Ensured Treeseed gitignore entries are present.' });
	const deprecatedFiles = warnDeprecatedLocalEnvFiles(tenantRoot);
	if (deprecatedFiles.length > 0) {
		actions.push({ id: 'deprecated-local-env', detail: 'Detected deprecated .env.local/.dev.vars files that Treeseed now ignores.' });
	}

	const deployConfig = loadCliDeployConfig(tenantRoot);
	const { configPath } = getMachineConfigPaths(tenantRoot);
	if (!existsSync(configPath)) {
		const machineConfig = createDefaultMachineConfig({
			tenantRoot,
			deployConfig,
			tenantConfig: undefined,
		});
		writeMachineConfig(tenantRoot, machineConfig);
		actions.push({ id: 'machine-config', detail: 'Created the default Treeseed machine config.' });
	}

	resolveMachineEnvironmentValues(tenantRoot, 'local');
	actions.push({ id: 'machine-key', detail: 'Ensured the Treeseed machine key exists.' });

	const machineConfig = loadMachineConfig(tenantRoot);
	writeMachineConfig(tenantRoot, machineConfig);

	const stateRoot = resolve(tenantRoot, '.treeseed', 'state', 'environments');
	if (existsSync(stateRoot)) {
		for (const scope of ['local', 'staging', 'prod'] as const) {
			const target = createPersistentDeployTarget(scope);
			const state = loadDeployState(tenantRoot, deployConfig, { target });
			if (state.readiness?.initialized || scope === 'local') {
				ensureGeneratedWranglerConfig(tenantRoot, { target });
				actions.push({ id: `wrangler-${scope}`, detail: `Regenerated the ${scope} generated Wrangler config.` });
			}
		}
	}

	return dedupeRepairActions(actions);
}

function dedupeRepairActions(actions: RepairAction[]) {
	const seen = new Set<string>();
	return actions.filter((action) => {
		if (seen.has(action.id)) return false;
		seen.add(action.id);
		return true;
	});
}

export function copyOperationalState(sourceRoot: string, targetRoot: string) {
	const sourceStateRoot = resolve(sourceRoot, '.treeseed');
	if (!existsSync(sourceStateRoot)) {
		return;
	}
	const targetStateRoot = resolve(targetRoot, '.treeseed');
	mkdirSync(targetStateRoot, { recursive: true });
	copyDirectory(sourceStateRoot, targetStateRoot);
}

function copyDirectory(sourceDir: string, targetDir: string) {
	mkdirSync(targetDir, { recursive: true });
	for (const entry of readdirSafe(sourceDir)) {
		const sourcePath = resolve(sourceDir, entry.name);
		const targetPath = resolve(targetDir, entry.name);
		if (entry.isDirectory()) {
			copyDirectory(sourcePath, targetPath);
			continue;
		}
		writeFileSync(targetPath, readFileSync(sourcePath));
	}
}

function readdirSafe(sourceDir: string) {
	return existsSync(sourceDir) ? readdirSync(sourceDir, { withFileTypes: true }) : [];
}
