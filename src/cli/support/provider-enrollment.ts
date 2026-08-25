import { spawn } from 'node:child_process';
import { invokeLocalHostManager } from './host-client.js';

export async function handoffProviderEnrollment(payload: Record<string, unknown>, env: NodeJS.ProcessEnv, localInvoke: (input: unknown) => Promise<unknown> = invokeLocalHostManager) {
	const executable = env.TREESEED_PROVIDER_ENROLL_EXECUTABLE?.trim();
	if (!executable) return localInvoke({
		handlerId: 'local.host.provider.enrollment',
		arguments: [],
		options: { payload: JSON.stringify(payload) },
	}) as Promise<Record<string, unknown>>;
	let args: string[] = [];
	if (env.TREESEED_PROVIDER_ENROLL_ARGUMENTS) {
		const parsed = JSON.parse(env.TREESEED_PROVIDER_ENROLL_ARGUMENTS);
		if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) throw new Error('TREESEED_PROVIDER_ENROLL_ARGUMENTS must be a JSON string array.');
		args = parsed;
	}
	return new Promise<Record<string, unknown>>((resolve, reject) => {
		const child = spawn(executable, args, { env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
		let stdout = ''; let stderr = '';
		child.stdout.on('data', (value) => { stdout += String(value).slice(0, 64 * 1024 - stdout.length); });
		child.stderr.on('data', (value) => { stderr += String(value).slice(0, 16 * 1024 - stderr.length); });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) { reject(Object.assign(new Error(stderr.trim() || 'The local provider manager rejected enrollment.'), { category: 'provider_unavailable', code: 'provider_enrollment_handoff_failed' })); return; }
			try { resolve(JSON.parse(stdout) as Record<string, unknown>); }
			catch { reject(new Error('The local provider manager returned an invalid enrollment receipt.')); }
		});
		child.stdin.end(JSON.stringify(payload));
	});
}
