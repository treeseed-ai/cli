import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareCloudflareLocalRuntime, spawnProcess, startWranglerDev } from './local-dev-lib.ts';
import { fixtureRoot, fixtureWranglerConfig } from './paths.ts';

const TEST_PORT = 8791;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = `${Date.now()}-${process.pid}`;
const ipSeed = Date.now() + process.pid;
const TEST_IP = `198.51.${(ipSeed >>> 8) % 250}.${ipSeed % 250}`;
const TEST_EMAIL = `integration-subscriber-${RUN_ID}@localhost.test`;
const PERSIST_TO = resolve(process.cwd(), '.local', 'cloudflare-integration', RUN_ID);
const workerLogs = [];

mkdirSync(PERSIST_TO, { recursive: true });

function captureLogs(stream, label) {
	if (!stream) {
		return;
	}

	stream.setEncoding('utf8');
	stream.on('data', (chunk) => {
		workerLogs.push(`[${label}] ${chunk}`);
		if (workerLogs.length > 40) {
			workerLogs.shift();
		}
	});
}

function readBody(message) {
	return new Promise((resolve) => {
		let body = '';
		message.setEncoding('utf8');
		message.on('data', (chunk) => {
			body += chunk;
		});
		message.on('end', () => resolve(body));
	});
}

function extractSetCookie(response) {
	if (typeof response.headers.getSetCookie === 'function') {
		return response.headers.getSetCookie();
	}

	const cookie = response.headers.get('set-cookie');
	return cookie ? [cookie] : [];
}

async function waitForWorker(worker) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (worker.exitCode !== null) {
			throw new Error(
				`Wrangler exited before the worker became ready (exit ${worker.exitCode}).\n${workerLogs.join('')}`,
			);
		}

		try {
			const response = await fetch(`${BASE_URL}/api/form/submit?formType=subscribe`, {
				signal: AbortSignal.timeout(5000),
				headers: {
					'x-forwarded-for': TEST_IP,
				},
			});
			if (response.ok) {
				return;
			}
		} catch {
			// Keep polling until the local worker is ready.
		}

		await delay(1000);
	}

	throw new Error(`Timed out waiting for local Wrangler dev to start.\n${workerLogs.join('')}`);
}

async function issueToken() {
	const response = await fetch(`${BASE_URL}/api/form/submit?formType=subscribe`, {
		signal: AbortSignal.timeout(10000),
		headers: {
			'x-forwarded-for': TEST_IP,
		},
	});

	assert.equal(response.status, 200, 'token endpoint should return HTTP 200');
	const payload = await response.json();
	const cookies = extractSetCookie(response);
	assert.equal(payload.ok, true, 'token payload should be ok');
	assert.ok(payload.formToken, 'token endpoint should return a form token');
	assert.ok(payload.sessionId, 'token endpoint should return a session id');
	assert.ok(cookies.length > 0, 'token endpoint should set a session cookie');

	return {
		formToken: payload.formToken,
		sessionId: payload.sessionId,
		cookieHeader: cookies.map((cookie) => cookie.split(';', 1)[0]).join('; '),
	};
}

async function submitSubscribeForm({ formToken, sessionId, cookieHeader }, email = TEST_EMAIL) {
	const form = new FormData();
	form.set('formType', 'subscribe');
	form.set('name', 'Integration Test');
	form.set('email', email);
	form.set('formToken', formToken);
	form.set('formSession', sessionId);
	form.set('redirectTo', '/');

	return fetch(`${BASE_URL}/api/form/submit`, {
		method: 'POST',
		redirect: 'manual',
		signal: AbortSignal.timeout(10000),
		headers: {
			cookie: cookieHeader,
			origin: BASE_URL,
			referer: `${BASE_URL}/`,
			'x-forwarded-for': TEST_IP,
		},
		body: form,
	});
}

async function querySubscribers() {
	const query = `SELECT lookup_key AS email, status, json_extract(payload_json, '$.source') AS source FROM runtime_records WHERE record_type = 'subscription' AND lookup_key = '${TEST_EMAIL}'`;
	const child = spawnProcess(
		'wrangler',
		[
			'd1',
			'execute',
			'karyon-docs-site-data',
			'--local',
			'--config',
			fixtureWranglerConfig,
			'--persist-to',
			PERSIST_TO,
			'--json',
			'--command',
			query,
		],
		{ stdio: ['ignore', 'pipe', 'inherit'], cwd: fixtureRoot },
	);

	const stdout = await readBody(child.stdout);
	const exitCode = await new Promise((resolve) => {
		child.on('exit', resolve);
	});

	assert.equal(exitCode, 0, 'local D1 query should succeed');
	const parsed = JSON.parse(stdout);
	const results = Array.isArray(parsed) ? parsed : [parsed];
	const rows = results.flatMap((entry) => entry.results ?? []);
	return rows;
}

async function main() {
	prepareCloudflareLocalRuntime({
		persistTo: PERSIST_TO,
		envOverrides: {
			TREESEED_LOCAL_DEV_MODE: 'cloudflare',
			TREESEED_FORMS_LOCAL_BYPASS_TURNSTILE: 'true',
			TREESEED_PUBLIC_FORMS_LOCAL_BYPASS_TURNSTILE: 'true',
			TREESEED_FORMS_LOCAL_BYPASS_CLOUDFLARE_GUARDS: 'false',
			TREESEED_FORMS_LOCAL_USE_MAILPIT: 'true',
			TREESEED_MAILPIT_SMTP_HOST: '127.0.0.1',
			TREESEED_MAILPIT_SMTP_PORT: '1025',
		},
	});

	const worker = startWranglerDev(['--port', String(TEST_PORT), '--persist-to', PERSIST_TO], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	captureLogs(worker.stdout, 'stdout');
	captureLogs(worker.stderr, 'stderr');

	const teardown = async () => {
		if (worker.exitCode === null && !worker.killed) {
			worker.kill('SIGTERM');
			await Promise.race([
				new Promise((resolve) => worker.once('exit', resolve)),
				delay(5000),
			]);
			if (worker.exitCode === null && !worker.killed) {
				worker.kill('SIGKILL');
				await Promise.race([
					new Promise((resolve) => worker.once('exit', resolve)),
					delay(5000),
				]);
			}
		}
	};

	process.on('SIGINT', async () => {
		await teardown();
		process.exit(130);
	});

	process.on('SIGTERM', async () => {
		await teardown();
		process.exit(143);
	});

	let shouldQuerySubscribers = false;

	try {
		await waitForWorker(worker);

		const firstToken = await issueToken();
		const firstResponse = await submitSubscribeForm(firstToken);
		assert.equal(firstResponse.status, 303, 'subscribe submit should redirect');
		assert.match(
			firstResponse.headers.get('location') ?? '',
			/\/\?formStatus=success&formCode=success#site-subscribe$/,
			'subscribe success redirect should include success markers',
		);

		shouldQuerySubscribers = true;

		const replayResponse = await submitSubscribeForm(firstToken);
		assert.equal(replayResponse.status, 303, 'replayed submit should still redirect');
		assert.match(
			replayResponse.headers.get('location') ?? '',
			/\/\?formStatus=error&formCode=token_replayed#site-subscribe$/,
			'replayed token should be rejected by KV-backed nonce storage',
		);

		for (let attempt = 0; attempt < 2; attempt += 1) {
			const token = await issueToken();
			const response = await submitSubscribeForm(token);
			assert.equal(response.status, 303, 'pre-limit submissions should redirect');
			assert.match(
				response.headers.get('location') ?? '',
				/\/\?formStatus=success&formCode=success#site-subscribe$/,
				'pre-limit submissions should succeed',
			);
		}

		const limitedToken = await issueToken();
		const limitedResponse = await submitSubscribeForm(limitedToken);
		assert.equal(limitedResponse.status, 303, 'rate-limited submit should redirect');
		assert.match(
			limitedResponse.headers.get('location') ?? '',
			/\/\?formStatus=error&formCode=rate_limited#site-subscribe$/,
			'local KV-backed rate limiting should reject the fourth submission',
		);
	} finally {
		await teardown();
	}

	if (shouldQuerySubscribers) {
		const rows = await querySubscribers();
		assert.equal(rows.length, 1, 'subscriber should be written to local D1');
		assert.equal(rows[0].email, TEST_EMAIL, 'subscriber email should match the submitted address');
		assert.equal(rows[0].status, 'active', 'subscriber should be active');
		assert.equal(rows[0].source, 'footer', 'subscriber source should be tracked');
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
