import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	createDefaultTreeseedMachineConfig,
	ensureTreeseedGitignoreEntries,
	getTreeseedMachineConfigPaths,
	loadCliDeployConfig,
	loadDeployState,
	loadTreeseedMachineConfig,
	resolveTreeseedMachineEnvironmentValues,
	warnDeprecatedTreeseedLocalEnvFiles,
	writeTreeseedMachineConfig,
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
} from '@treeseed/sdk/workflow-support';

export type TreeseedRepairAction = {
	id: string;
	detail: string;
};

export function applyTreeseedSafeRepairs(tenantRoot: string): TreeseedRepairAction[] {
	const actions: TreeseedRepairAction[] = [];
	ensureTreeseedGitignoreEntries(tenantRoot);
	actions.push({ id: 'gitignore', detail: 'Ensured Treeseed gitignore entries are present.' });
	const deprecatedFiles = warnDeprecatedTreeseedLocalEnvFiles(tenantRoot);
	if (deprecatedFiles.length > 0) {
		actions.push({ id: 'deprecated-local-env', detail: 'Detected deprecated .env.local/.dev.vars files that Treeseed now ignores.' });
	}

	const deployConfig = loadCliDeployConfig(tenantRoot);
	const { configPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (!existsSync(configPath)) {
		const machineConfig = createDefaultTreeseedMachineConfig({
			tenantRoot,
			deployConfig,
			tenantConfig: undefined,
		});
		writeTreeseedMachineConfig(tenantRoot, machineConfig);
		actions.push({ id: 'machine-config', detail: 'Created the default Treeseed machine config.' });
	}

	resolveTreeseedMachineEnvironmentValues(tenantRoot, 'local');
	actions.push({ id: 'machine-key', detail: 'Ensured the Treeseed machine key exists.' });

	const machineConfig = loadTreeseedMachineConfig(tenantRoot);
	writeTreeseedMachineConfig(tenantRoot, machineConfig);

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

function dedupeRepairActions(actions: TreeseedRepairAction[]) {
	const seen = new Set<string>();
	return actions.filter((action) => {
		if (seen.has(action.id)) return false;
		seen.add(action.id);
		return true;
	});
}

export function copyTreeseedOperationalState(sourceRoot: string, targetRoot: string) {
	const sourceTreeseedRoot = resolve(sourceRoot, '.treeseed');
	if (!existsSync(sourceTreeseedRoot)) {
		return;
	}
	const targetTreeseedRoot = resolve(targetRoot, '.treeseed');
	mkdirSync(targetTreeseedRoot, { recursive: true });
	copyDirectory(sourceTreeseedRoot, targetTreeseedRoot);
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
