import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { CommandContext } from '../types.js';

export async function promptText(context: CommandContext, question: string) {
	if (context.prompt) return String(await context.prompt(question)).trim();
	if (!stdin.isTTY || !stdout.isTTY) throw new Error(`${question.trim()} requires an interactive TTY.`);
	const prompt = readline.createInterface({ input: stdin, output: stdout });
	try { return (await prompt.question(question)).trim(); } finally { prompt.close(); }
}

export function promptHidden(question: string) {
	return new Promise<string>((resolvePromise, reject) => {
		if (!stdin.isTTY || !stdout.isTTY) { reject(new Error('Secret input requires an interactive TTY.')); return; }
		let value = '';
		const cleanup = () => { stdin.removeListener('data', onData); stdin.setRawMode(false); stdout.write('\n'); };
		const onData = (chunk: Buffer | string) => {
			for (const char of String(chunk)) {
				if (char === '\n' || char === '\r') { cleanup(); resolvePromise(value); return; }
				if (char === '\u0003') { cleanup(); reject(new Error('Input cancelled.')); return; }
				if (char === '\u007f') value = value.slice(0, -1); else value += char;
			}
		};
		stdout.write(question); stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
	});
}
