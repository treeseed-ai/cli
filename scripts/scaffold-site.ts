#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { resolveTemplateDefinition, buildTemplateReplacements, validateAllTemplateDefinitions } from './template-registry-lib.ts';

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

function replaceTokens(contents, replacements) {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replaceAll(token, value),
    contents,
  );
}

function writeTemplateTree(sourceRoot, targetRoot, replacements) {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      writeTemplateTree(sourcePath, targetPath, replacements);
      continue;
    }

    const raw = readFileSync(sourcePath, 'utf8');
    writeFileSync(targetPath, replaceTokens(raw, replacements), 'utf8');
  }
}

validateAllTemplateDefinitions();
const options = parseArgs(process.argv.slice(2));
const targetRoot = resolve(process.cwd(), options.target);
const definition = resolveTemplateDefinition(options.template, 'starter');
const replacements = buildTemplateReplacements(definition.manifest, {
  target: basename(targetRoot),
  name: options.name,
  slug: options.slug,
  siteUrl: options.siteUrl,
  contactEmail: options.contactEmail,
  repositoryUrl: options.repositoryUrl,
  discordUrl: options.discordUrl,
});

if (existsSync(targetRoot) && readdirSync(targetRoot).length > 0) {
  throw new Error(`Target directory is not empty: ${targetRoot}`);
}

mkdirSync(targetRoot, { recursive: true });
writeTemplateTree(definition.templateRoot, targetRoot, replacements);
console.log(`Created Treeseed tenant from ${definition.manifest.id} at ${targetRoot}`);
console.log('Next steps:');
console.log(`  cd ${options.target}`);
console.log('  npm install');
console.log('  # set cloudflare.accountId in treeseed.site.yaml (or export CLOUDFLARE_ACCOUNT_ID)');
console.log('  wrangler login');
console.log('  treeseed config --environment local');
console.log('  treeseed config --environment staging --environment prod');
console.log('  treeseed start feature/my-change');
console.log('  treeseed deploy --environment staging --dry-run');
console.log('  treeseed save "describe your change"');
console.log('  treeseed release --patch');
console.log('  treeseed destroy --environment staging --dry-run');
