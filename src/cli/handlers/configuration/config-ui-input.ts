import { spawnSync } from 'node:child_process';
import type { ConfigInputState } from './config-ui-types.js';
import { insertAt } from './config-ui-layout.js';

export function normalizeConfigInputChunk(input: string) {
	if (!input) {
		return '';
	}
	return input
		.replace(/\u001b\[200~/gu, '')
		.replace(/\u001b\[201~/gu, '')
		.replace(/\r\n/gu, '\n')
		.replace(/\r/gu, '\n')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
		.replace(/\n+$/gu, '');
}

export function applyConfigInputInsertion(state: ConfigInputState, input: string): ConfigInputState {
	const normalized = normalizeConfigInputChunk(input);
	if (!normalized) {
		return state;
	}
	return {
		value: insertAt(state.value, normalized, state.cursor),
		cursor: state.cursor + normalized.length,
	};
}

export function runClipboardCommand(command: string, args: string[]) {
	const result = spawnSync(command, args, {
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: 1500,
	});
	if (result.status !== 0) {
		return null;
	}
	const text = String(result.stdout ?? '').replace(/\r\n/gu, '\n');
	return text.length > 0 ? text : null;
}

export function readLinuxClipboardText() {
	if (process.platform !== 'linux') {
		return null;
	}
	return runClipboardCommand('wl-paste', ['--no-newline'])
		?? runClipboardCommand('xclip', ['-selection', 'clipboard', '-o'])
		?? runClipboardCommand('xsel', ['--clipboard', '--output']);
}

export function isCtrlVPaste(input: string, key: { ctrl?: boolean }) {
	return (key.ctrl && input === 'v') || input === '\u0016';
}
