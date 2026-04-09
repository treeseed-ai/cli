#!/usr/bin/env node

import { resolve } from 'node:path';
import { scaffoldTemplateProject } from './template-registry-lib.ts';

function parseArgs(argv) {
  const args = {
    target: null,
    template: 'starter-basic',
    name: null,
    slug: null,
    siteUrl: null,
    contactEmail: null,
    repositoryUrl: null,
    discordUrl: 'https://discord.gg/example',
  };
  const rest = [...argv];
  while (rest.length > 0) {
    const current = rest.shift();
    if (!current) continue;
    if (!args.target && !current.startsWith('--')) {
      args.target = current;
      continue;
    }
    if (current === '--template') args.template = rest.shift() ?? args.template;
    else if (current === '--name') args.name = rest.shift() ?? null;
    else if (current === '--slug') args.slug = rest.shift() ?? null;
    else if (current === '--site-url') args.siteUrl = rest.shift() ?? null;
    else if (current === '--contact-email') args.contactEmail = rest.shift() ?? null;
    else if (current === '--repo') args.repositoryUrl = rest.shift() ?? null;
    else if (current === '--discord') args.discordUrl = rest.shift() ?? args.discordUrl;
    else throw new Error(`Unknown argument: ${current}`);
  }
  if (!args.target) throw new Error('Usage: treeseed init <directory> [--template <starter-id>] [--name <site name>] [--slug <slug>] [--site-url <url>] [--contact-email <email>] [--repo <url>] [--discord <url>]');
  return args;
}

const options = parseArgs(process.argv.slice(2));
const targetRoot = resolve(process.cwd(), options.target);

const definition = await scaffoldTemplateProject(options.template, targetRoot, {
	target: options.target,
	name: options.name,
	slug: options.slug,
	siteUrl: options.siteUrl,
	contactEmail: options.contactEmail,
	repositoryUrl: options.repositoryUrl,
	discordUrl: options.discordUrl,
}, {
	writeWarning: (message) => console.warn(message),
});
console.log(`Created Treeseed tenant from ${definition.id} at ${targetRoot}`);
console.log('Next steps:');
console.log(`  cd ${options.target}`);
console.log('  npm install');
console.log('  treeseed template show starter-basic');
console.log('  treeseed sync --check');
console.log('  treeseed config --environment local');
console.log('  treeseed dev');
