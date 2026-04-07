import { stopKnownMailpitContainers } from './mailpit-runtime.ts';

if (!stopKnownMailpitContainers()) {
	process.exit(1);
}

console.log('Mailpit is stopped.');
