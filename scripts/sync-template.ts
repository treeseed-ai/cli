#!/usr/bin/env node

import { syncTemplateProject } from './template-registry-lib.ts';

const args = process.argv.slice(2);
const check = args.includes('--check');
const changed = await syncTemplateProject(process.cwd(), {
	check,
	writeWarning: (message) => console.warn(message),
});

if (check) {
	if (changed.length === 0) {
		console.log('managed surface is up to date');
	} else {
		console.log(`managed surface drift: ${changed.join(', ')}`);
		process.exitCode = 1;
	}
} else {
	console.log(changed.length === 0 ? 'managed surface already up to date' : `updated: ${changed.join(', ')}`);
}
