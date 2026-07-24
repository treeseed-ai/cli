export function promptHidden(question: string) {
	return new Promise<string>((resolvePromise) => {
		const stdin = process.stdin;
		const stdout = process.stdout;
		let value = '';

		function cleanup() {
			stdin.removeListener('data', onData);
			if (stdin.isTTY) {
				stdin.setRawMode(false);
			}
			stdout.write('\n');
		}

		function onData(chunk: Buffer | string) {
			const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
			for (const char of text) {
				if (char === '\n' || char === '\r') {
					cleanup();
					resolvePromise(value);
					return;
				}
				if (char === '\u0003') {
					cleanup();
					process.exit(1);
				}
				if (char === '\u007f') {
					value = value.slice(0, -1);
					continue;
				}
				value += char;
			}
		}

		stdout.write(question);
		if (stdin.isTTY) {
			stdin.setRawMode(true);
		}
		stdin.resume();
		stdin.on('data', onData);
	});
}

export async function promptForNewPassphrase() {
	const passphrase = (await promptHidden('New Treeseed passphrase: ')).trim();
	if (!passphrase) {
		throw new Error('A non-empty passphrase is required.');
	}
	const confirmation = (await promptHidden('Confirm passphrase: ')).trim();
	if (passphrase !== confirmation) {
		throw new Error('The passphrase confirmation did not match.');
	}
	return passphrase;
}
