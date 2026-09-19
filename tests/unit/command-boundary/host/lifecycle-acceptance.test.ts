import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

const readCommands = [
	['status', 'local.host.status'], ['doctor', 'local.host.doctor'], ['plan', 'local.host.plan'],
] as const;
const mutationCommands = [
	['apply', 'local.host.apply'], ['reconcile', 'local.host.reconcile'],
	['start', 'local.host.start'], ['stop', 'local.host.stop'],
] as const;

test('every top-level host lifecycle read uses its exact manager operation and returns the stable envelope', async () => {
	for (const [name, handlerId] of readCommands) {
		const calls: unknown[] = [], output: string[] = [];
		assert.equal(await runCommandLine(['host', name, '--json'], {
			interactiveUi: false, hostInvoke: async request => { calls.push(request); return { command: name, state: 'running' }; },
			write: value => output.push(value),
		}), 0, name);
		assert.deepEqual(calls, [{ handlerId, arguments: [], options: {} }], name);
		assert.deepEqual(JSON.parse(output.at(-1)!).result, { command: name, state: 'running' }, name);
	}
});

test('every top-level host lifecycle mutation supports a side-effect-free plan and an explicit execute path', async () => {
	for (const [name, handlerId] of mutationCommands) {
		for (const plan of [true, false]) {
			const calls: Array<{ handlerId: string; arguments: string[]; options: Record<string, unknown> }> = [], output: string[] = [];
			assert.equal(await runCommandLine(['host', name, plan ? '--plan' : '--yes', '--json'], {
				interactiveUi: false, hostInvoke: async request => {
					calls.push(request as typeof calls[number]);
					return request.handlerId === 'local.dev.status' ? { sessions: [] } : { command: name, state: plan ? 'planned' : 'running' };
				}, write: value => output.push(value),
			}), 0, `${name} ${plan ? 'plan' : 'execute'}`);
			assert.deepEqual(calls.at(-1), { handlerId, arguments: [], options: plan ? { plan: true } : {} }, name);
			assert.equal(calls.filter(call => call.handlerId === handlerId).length, 1, name);
			assert.equal(calls.some(call => call.handlerId === 'local.dev.status'), !plan && ['start', 'stop'].includes(name), name);
			assert.equal(JSON.parse(output.at(-1)!).result.state, plan ? 'planned' : 'running', name);
		}
	}
});

test('configuration show, plan, apply, and stage use the same validated file and preserve plan/execute custody', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-host-lifecycle-cli-'));
	try {
		const file = resolve(root, 'host.json');
		writeFileSync(file, JSON.stringify({ schemaVersion: 'treeseed.host/v1', configurationId: 'acceptance-host', generation: 1,
			host: { id: 'acceptance-host', role: 'integrated', architecture: 'amd64' },
			runtime: { management: 'managed', environment: 'development', dataRoot: resolve(root, '.treeseed/data') },
			updates: { defaultTrack: 'development', stable: { metadataPollSeconds: 86400, maintenanceWindow: { weekday: 'sunday', localTime: '03:00', jitterMinutes: 20 } }, development: { pollSeconds: 60 } },
			components: {}, network: { manager: { binding: '127.0.0.1:4790', aliases: [], sans: [], trustedLanCidrs: [] } },
			fleet: { rolloutGroup: 'acceptance-host', receiptReporting: { enabled: false, intervalSeconds: 300 } }, secrets: {} }));
		for (const [name, handlerId] of [['show', 'local.host.config.show'], ['plan', 'local.host.config.plan'],
			['apply', 'local.host.config.apply'], ['stage', 'local.host.config.stage']] as const) {
			for (const plan of name === 'apply' || name === 'stage' ? [true, false] : [false]) {
				const calls: any[] = [], output: string[] = [];
				const argv = ['host', 'config', name, ...(name === 'show' ? [] : [file]), ...(plan ? ['--plan'] : name === 'apply' || name === 'stage' ? ['--yes'] : []), '--json'];
				assert.equal(await runCommandLine(argv, { interactiveUi: false, hostInvoke: async request => { calls.push(request); return { applied: !plan }; }, write: value => output.push(value) }), 0, `${argv.join(' ')}: ${output.join('')}`);
				assert.equal(calls.length, 1, name);
				assert.equal(calls[0].handlerId, handlerId, name);
				assert.deepEqual(calls[0].arguments, [], name);
				assert.deepEqual(calls[0].options, plan ? { plan: true } : {}, name);
				if (name !== 'show') assert.equal(calls[0].configuration.configurationId, 'acceptance-host', name);
				assert.equal(JSON.parse(output.at(-1)!).result.applied, !plan, name);
			}
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('component list/status and enable/disable expose exact target and plan/execute boundary', async () => {
	for (const [name, handlerId, target] of [['list', 'local.host.component.list', false], ['status', 'local.host.component.status', true],
		['enable', 'local.host.component.enable', true], ['disable', 'local.host.component.disable', true]] as const) {
		for (const plan of name === 'enable' || name === 'disable' ? [true, false] : [false]) {
			const calls: any[] = [];
			assert.equal(await runCommandLine(['host', 'component', name, ...(target ? ['agent'] : []), ...(plan ? ['--plan'] : name === 'enable' || name === 'disable' ? ['--yes'] : []), '--json'], {
				interactiveUi: false, hostInvoke: async request => { calls.push(request); return { componentId: 'agent', state: plan ? 'planned' : 'ready' }; }, write() {},
			}), 0, name);
			assert.deepEqual(calls, [{ handlerId, arguments: target ? ['agent'] : [], options: plan ? { plan: true } : {} }], name);
		}
	}
});

test('update, recovery, and remaining lifecycle reads route to the exact manager contract', async () => {
	const commands = [
		['events', 'local.host.events'], ['topology', 'local.host.topology'],
		['connections', 'local.host.connections'], ['aliases list', 'local.host.aliases.list'],
		['fleet status', 'local.host.fleet.status'], ['provider status', 'local.host.provider.status'],
		['security plan', 'local.host.security.plan'], ['security status', 'local.host.security.status'],
		['security verify', 'local.host.security.verify'], ['sandbox status', 'local.host.sandbox.status'],
		['sandbox doctor', 'local.host.sandbox.doctor'], ['bootstrap status', 'local.host.bootstrap.status'],
		['update status', 'local.host.update.status'], ['update check', 'local.host.update.check'],
		['recovery status', 'local.host.recovery.status'],
	] as const;
	for (const [path, handlerId] of commands) {
		const calls: unknown[] = [], output: string[] = [];
		const argv = ['host', ...path.split(' '), '--json'];
		assert.equal(await runCommandLine(argv, {
			interactiveUi: false, hostInvoke: async request => { calls.push(request); return { state: 'ready' }; },
			write: value => output.push(value),
		}), 0, path);
		assert.deepEqual(calls, [{ handlerId, arguments: [], options: {} }], path);
		assert.equal(JSON.parse(output.at(-1)!).result.state, 'ready', path);
	}
});

test('update and recovery mutations retain target, plan boundary, and stable result envelope', async () => {
	const commands = [
		['update apply', 'local.host.update.apply', []],
		['update channel', 'local.host.update.channel', ['development']],
		['update pause', 'local.host.update.pause', []],
		['update resume', 'local.host.update.resume', []],
		['recovery retry', 'local.host.recovery.retry', []],
		['recovery restore', 'local.host.recovery.restore', ['42']],
	] as const;
	for (const [path, handlerId, args] of commands) {
		for (const plan of [true, false]) {
			const calls: unknown[] = [], output: string[] = [];
			const argv = ['host', ...path.split(' '), ...args, plan ? '--plan' : '--yes', '--json'];
			assert.equal(await runCommandLine(argv, {
				interactiveUi: false, hostInvoke: async request => { calls.push(request); return { mutation: !plan }; },
				write: value => output.push(value),
			}), 0, path);
			assert.deepEqual(calls, [{ handlerId, arguments: [...args], options: plan ? { plan: true } : {} }], path);
			assert.equal(JSON.parse(output.at(-1)!).result.mutation, !plan, path);
		}
	}
});

test('uninstall and reset require explicit destructive confirmation before manager execution', async () => {
	for (const name of ['uninstall', 'reset']) {
		const calls: unknown[] = [], output: string[] = [];
		const exitCode = await runCommandLine(['host', name, '--yes', '--json'], {
			interactiveUi: false, hostInvoke: async request => { calls.push(request); return { state: 'removed' }; },
			write: value => output.push(value),
		});
		assert.notEqual(exitCode, 0, name);
		assert.deepEqual(calls, [], name);
		assert.equal(JSON.parse(output.at(-1)!).ok, false, name);
	}
});
