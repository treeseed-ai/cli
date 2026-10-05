import assert from 'node:assert/strict';
import test from 'node:test';
import { browserLaunchCommand } from '../../../src/cli/support/open-browser.js';

const url = 'https://admin.treeseed.localhost/auth/device/approve?user_code=ABCD-EFGH';

test('browser launch commands pass the complete verification URL without shell interpolation', () => {
	assert.deepEqual(browserLaunchCommand(url, 'linux'), { command: 'xdg-open', arguments: [url] });
	assert.deepEqual(browserLaunchCommand(url, 'darwin'), { command: 'open', arguments: [url] });
	assert.deepEqual(browserLaunchCommand(url, 'win32'), { command: 'rundll32.exe', arguments: ['url.dll,FileProtocolHandler', url] });
});

test('browser launch commands fail closed for unsupported platforms and schemes', () => {
	assert.equal(browserLaunchCommand(url, 'aix'), null);
	assert.equal(browserLaunchCommand('file:///tmp/secret', 'linux'), null);
});
