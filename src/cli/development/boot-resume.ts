import { resumeDevelopmentSession } from '../commands/development.js';

// Invoked by the manager's fixed, unprivileged boot job, not by project source.
if (!process.getuid || process.getuid() === 0) throw new Error('Development processes must never resume as root.');
await resumeDevelopmentSession(process.argv[2] ?? '', {
	cwd: process.cwd(), env: process.env, outputFormat: 'json', interactiveUi: false,
	write: () => undefined,
});
