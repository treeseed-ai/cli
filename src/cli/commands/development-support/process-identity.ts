import { readFileSync, statSync } from 'node:fs';

/** A PID alone is not process custody: it may be reused, including after boot. */
export function processIdentity(pid: number): string | undefined {
	try {
		if (!Number.isSafeInteger(pid) || pid <= 1 || statSync(`/proc/${pid}`).uid !== process.getuid?.()) return;
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
		if (Number(fields[2]) !== pid || fields[0] === 'Z') return;
		return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${fields[19]}`;
	} catch { return; }
}

export function ownsDevelopmentProcess(entry: { pid: number; identity?: string }, sessionId: string): boolean {
	const current = processIdentity(entry.pid);
	if (!current) return false;
	if (entry.identity) return entry.identity === current;
	// Existing saved selections require same-user, session-marked process evidence.
	try {
		return readFileSync(`/proc/${entry.pid}/environ`, 'utf8').split('\0')
			.includes(`TREESEED_DEVELOPMENT_SESSION_ID=${sessionId}`);
	} catch { return false; }
}
