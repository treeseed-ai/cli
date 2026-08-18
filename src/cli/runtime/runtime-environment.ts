import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveLaunchEnvironment } from '@treeseed/sdk/workflow-support';
import { resolveWorkflowPaths } from '@treeseed/sdk/workflow-support';

export function hydrateProjectEnvironment(cwd: string, env: NodeJS.ProcessEnv) {
	const tenantRoot = resolveWorkflowPaths(cwd).tenantRoot;
	if (!tenantRoot || !existsSync(resolve(tenantRoot, '.treeseed', 'template-state.json'))) return env;
	const resolved = resolveLaunchEnvironment({ tenantRoot, scope: 'local', baseEnv: env });
	for (const [key,value] of Object.entries(resolved)) {
		if (typeof value === 'string' && value.length > 0) process.env[key] = value;
	}
	return { ...env, ...resolved };
}
