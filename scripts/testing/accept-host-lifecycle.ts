import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Run only on an explicitly selected disposable or development host. The CLI
// must cross the installed manager socket; replacing it with hostInvoke here
// would make this a parser test rather than lifecycle acceptance.
if (process.env.TREESEED_HOST_LIFECYCLE_ACCEPTANCE !== '1') {
	throw new Error('Set TREESEED_HOST_LIFECYCLE_ACCEPTANCE=1 to run the managed-host lifecycle acceptance.');
}

type RecordValue = Record<string, unknown>;
const commandPaths: string[] = [];
function object(value: unknown): RecordValue {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as RecordValue;
}
function invoke(...args: string[]): RecordValue {
	const result = spawnSync('trsd', [...args, '--json'], {
		encoding: 'utf8', timeout: 600_000, maxBuffer: 8 * 1024 * 1024,
	});
	const path = args.join(' ');
	commandPaths.push(path);
	if (result.error) throw new Error(`${path}: ${result.error.message}`);
	let envelope: RecordValue;
	try { envelope = object(JSON.parse(result.stdout)); }
	catch { throw new Error(`${path}: CLI did not return a JSON command result (exit ${result.status}).`); }
	if (result.status !== 0 || envelope.ok !== true) {
		const error = object(envelope.error ?? {});
		throw new Error(`${path}: ${String(error.code ?? 'command_failed')}: ${String(error.message ?? 'No diagnostic.')}`);
	}
	return object(envelope.result);
}

const configuration = invoke('host', 'config', 'show');
assert.equal(object(configuration.runtime).environment, 'development', 'Run this acceptance on a development host only.');
const components = object(configuration.components);
for (const id of ['ai-inference', 'ai-training', 'ai-lab']) {
	assert.equal(object(components[id]).enabled, false, `${id} must be explicitly disabled before this run.`);
}
const originalGeneration = configuration.generation;
const initial = invoke('host', 'status');
assert.equal(initial.lifecycle, 'running', 'Host must be running before the stop/start acceptance.');
assert.equal(invoke('host', 'doctor').healthy, true);
invoke('host', 'component', 'list');
invoke('host', 'update', 'status');
invoke('host', 'security', 'status');
invoke('host', 'sandbox', 'status');
assert.equal(invoke('host', 'uninstall', '--plan').mutation, false);
assert.equal(invoke('host', 'stop', '--plan').mutation, false);
assert.equal(invoke('host', 'status').lifecycle, 'running', 'Stop plan must not mutate host state.');

const stopped = invoke('host', 'stop', '--yes');
assert.equal(stopped.state, 'stopped');
assert.equal(invoke('host', 'status').lifecycle, 'stopped', 'Manager must remain reachable after stop.');
assert.equal(invoke('host', 'doctor').healthy, true, 'Intentional stop must not be reported unhealthy.');
assert.equal(object(invoke('host', 'update', 'status').state).runtimeStopped, true, 'Updater must honor the stop fence.');
assert.equal(invoke('host', 'stop', '--yes').changed, false, 'Repeated stop must be noop.');
assert.equal(invoke('host', 'start', '--plan').mutation, false);
assert.equal(invoke('host', 'status').lifecycle, 'stopped', 'Start plan must not mutate host state.');

const started = invoke('host', 'start', '--yes');
assert.equal(started.state, 'running');
assert.equal(invoke('host', 'status').lifecycle, 'running');
assert.equal(invoke('host', 'doctor').healthy, true);
assert.equal(object(invoke('host', 'update', 'status').state).runtimeStopped, false);
assert.equal(invoke('host', 'start', '--yes').changed, false, 'Repeated start must be noop.');
invoke('host', 'reconcile', '--plan');
assert.equal(invoke('host', 'status').lifecycle, 'running', 'Reconcile plan must not stop the host.');
invoke('host', 'reconcile', '--yes');

const after = invoke('host', 'config', 'show');
assert.equal(after.generation, originalGeneration, 'Stop/start must not rewrite host configuration.');
for (const id of ['ai-inference', 'ai-training', 'ai-lab']) {
	assert.equal(object(object(after.components)[id]).enabled, false, `${id} was re-enabled.`);
	invoke('host', 'component', 'status', id);
}
console.log(JSON.stringify({
	schemaVersion: 'treeseed.host-lifecycle-acceptance/v1', ok: true,
	configurationGeneration: originalGeneration, commands: commandPaths,
	stopChanged: stopped.changed, startChanged: started.changed,
	aiDisabled: true, managerReachableWhileStopped: true,
}));
