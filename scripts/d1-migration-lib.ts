import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveWranglerBin } from './package-tools.ts';

const DATABASE_BINDING = 'SITE_DATA_DB';

function runWrangler(args, { cwd, capture = false } = {}) {
	return spawnSync(process.execPath, [resolveWranglerBin(), ...args], {
		cwd,
		env: { ...process.env },
		stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		encoding: capture ? 'utf8' : undefined,
	});
}

function executeSqlFile({ cwd, wranglerConfig, filePath, persistTo }) {
	const args = ['d1', 'execute', DATABASE_BINDING, '--local', '--config', wranglerConfig, '--file', filePath];
	if (persistTo) {
		args.push('--persist-to', persistTo);
	}

	const result = runWrangler(args, { cwd });
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function executeSqlCommand({ cwd, wranglerConfig, command, persistTo, capture = false }) {
	const args = ['d1', 'execute', DATABASE_BINDING, '--local', '--config', wranglerConfig, '--command', command];
	if (persistTo) {
		args.push('--persist-to', persistTo);
	}

	const result = runWrangler(args, { cwd, capture });
	if (result.status !== 0) {
		if (capture) {
			if (result.stdout) process.stdout.write(result.stdout);
			if (result.stderr) process.stderr.write(result.stderr);
		}
		process.exit(result.status ?? 1);
	}

	return result;
}

function ensureSchemaMigrationsTable({ cwd, wranglerConfig, persistTo }) {
	executeSqlCommand({
		cwd,
		wranglerConfig,
		persistTo,
		command: `CREATE TABLE IF NOT EXISTS treeseed_schema_migrations (
			name TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		);`,
	});
}

function loadAppliedMigrations({ cwd, wranglerConfig, persistTo }) {
	const result = executeSqlCommand({
		cwd,
		wranglerConfig,
		persistTo,
		capture: true,
		command: 'SELECT name FROM treeseed_schema_migrations ORDER BY name ASC;',
	});
	const parsed = JSON.parse(result.stdout);
	const rows = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => entry.results ?? []);
	return new Set(rows.map((row) => row.name).filter(Boolean));
}

function markMigrationApplied({ cwd, wranglerConfig, persistTo, migration }) {
	executeSqlCommand({
		cwd,
		wranglerConfig,
		persistTo,
		command: `INSERT OR REPLACE INTO treeseed_schema_migrations (name, applied_at) VALUES ('${migration.replace(/'/g, "''")}', datetime('now'));`,
	});
}

export function runLocalD1Migrations({ cwd, wranglerConfig, migrationsRoot, persistTo }) {
	ensureSchemaMigrationsTable({ cwd, wranglerConfig, persistTo });
	const appliedMigrations = loadAppliedMigrations({ cwd, wranglerConfig, persistTo });
	const migrations = readdirSync(migrationsRoot)
		.filter((entry) => /^\d+.*\.sql$/i.test(entry))
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

	for (const migration of migrations) {
		if (appliedMigrations.has(migration)) {
			continue;
		}
		const filePath = resolve(migrationsRoot, migration);
		if (!existsSync(filePath)) {
			console.error(`Unable to find migration file at ${filePath}.`);
			process.exit(1);
		}

		executeSqlFile({ cwd, wranglerConfig, filePath, persistTo });
		markMigrationApplied({ cwd, wranglerConfig, persistTo, migration });
	}
}
