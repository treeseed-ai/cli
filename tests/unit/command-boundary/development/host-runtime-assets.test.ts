import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostDevelopmentRuntimeManifest } from '../../../../src/cli/commands/development-support/host-runtime.ts';

test('host runtime preserves only declared assets from its production closure', () => {
	const root = mkdtempSync(join(tmpdir(), 'host-assets-'));
	const asset = 'node_modules/backend/themes/login/theme.properties';
	const declare = (assets: unknown) => writeFileSync(join(root, 'package.json'), JSON.stringify({
		dependencies: { backend: '1' }, treeseed: { hostRuntimeDependencies: ['backend'], hostRuntimeAssets: assets },
	}));
	try {
		mkdirSync(join(root, 'dist'));
		mkdirSync(join(root, 'node_modules/backend/themes/login'), { recursive: true });
		writeFileSync(join(root, 'node_modules/backend/package.json'), '{}');
		writeFileSync(join(root, asset), 'parent=keycloak');
		writeFileSync(join(root, 'node_modules/backend/themes/login/unselected.css'), 'body {}');
		declare([asset]);
		const files = hostDevelopmentRuntimeManifest(root);
		assert.deepEqual(files.find(file => file.path === asset), { path: asset, size: 15,
			sha256: `sha256:${createHash('sha256').update('parent=keycloak').digest('hex')}` });
		assert.equal(files.some(file => file.path.endsWith('unselected.css')), false);
		for (const invalid of ['not-an-array', [null], ['../secret'], ['/etc/secret'], ['node_modules/backend/../secret'], ['dist/secret']]) {
			declare(invalid); assert.throws(() => hostDevelopmentRuntimeManifest(root), /exact production dependency/);
		}
		mkdirSync(join(root, 'node_modules/unmanaged'));
		writeFileSync(join(root, 'node_modules/unmanaged/secret.css'), 'unmanaged');
		for (const missing of ['node_modules/backend/missing.css', 'node_modules/unmanaged/secret.css']) {
			declare([missing]); assert.throws(() => hostDevelopmentRuntimeManifest(root), /missing from the production dependency closure/);
		}
		declare([asset]); rmSync(join(root, asset));
		symlinkSync(join(root, 'package.json'), join(root, asset));
		assert.throws(() => hostDevelopmentRuntimeManifest(root), /symbolic link/);
	} finally { rmSync(root, { recursive: true }); }
});
