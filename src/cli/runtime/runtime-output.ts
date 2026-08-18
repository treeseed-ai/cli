import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';

function isNoColorFlag(value: string | undefined) {
	return value === '--no-color';
}

export function stripGlobalFlags(argv: string[]) {
	return argv.filter((value) => !isNoColorFlag(value));
}

export function resolveColorEnabled(argv: string[], env: NodeJS.ProcessEnv, override?: boolean) {
	if (typeof override === 'boolean') return override;
	if (argv.some(isNoColorFlag)) return false;
	if (env.NO_COLOR !== undefined || env.TREESEED_NO_COLOR === '1' || env.TREESEED_NO_COLOR === 'true') return false;
	return true;
}

function colorCodeForBootstrapSystem(system: string) {
	switch (system) {
		case 'github': return '35;1';
		case 'data': return '34;1';
		case 'web': return '36;1';
		case 'api': return '32;1';
		case 'agents': return '33;1';
		case 'skip': return '90;1';
		default: return '37;1';
	}
}

export function colorizeCliOutput(output: string, colorEnabled = true) {
	if (!colorEnabled) return output;
	return output.replace(/^((?:\[[^\]]+\]){2,4})(\s|$)/u, (match, prefix: string, suffix: string) => {
		const segments = [...prefix.matchAll(/\[([^\]]+)\]/gu)].map((entry) => entry[1]);
		if (segments.length === 2) {
			const stage = segments[1] ?? '';
			const code = /fail|error/iu.test(stage) ? '31;1' : /skip/iu.test(stage) ? '90;1' : '32;1';
			return `\u001b[${code}m${prefix}\u001b[0m${suffix}`;
		}
		const system = segments[1] ?? '';
		const stage = segments[segments.length - 1] ?? '';
		const code = /fail|error/iu.test(stage) ? '31;1' : /skip/iu.test(stage) ? '90;1' : colorCodeForBootstrapSystem(system);
		return `\u001b[${code}m${prefix}\u001b[0m${suffix}`;
	});
}

export function defaultWrite(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!output) return;
	const fd = stream === 'stderr' ? process.stderr.fd : process.stdout.fd;
	const buffer = Buffer.from(`${output}\n`);
	let offset = 0;
	const retryView = new Int32Array(new SharedArrayBuffer(4));
	while (offset < buffer.length) {
		try {
			offset += writeSync(fd, buffer, offset, Math.min(buffer.length - offset, 16_384));
		} catch (error) {
			if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EAGAIN') {
				Atomics.wait(retryView, 0, 0, 10);
				continue;
			}
			throw error;
		}
	}
}

export function defaultSpawn(command: string, args: string[], options: {
	cwd: string;
	env: NodeJS.ProcessEnv;
	stdio?: 'inherit' | 'pipe';
	timeout?: number;
	killSignal?: NodeJS.Signals;
}) {
	return spawnSync(command, args, options);
}
