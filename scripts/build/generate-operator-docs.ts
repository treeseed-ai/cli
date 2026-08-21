import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
	TREESEED_COMMAND_TREE_V1,
	listCommandPaths,
	type CommandNodeDescriptor,
} from '@treeseed/sdk/operator-contracts';

const root = process.cwd();
const paths = listCommandPaths(TREESEED_COMMAND_TREE_V1);

function markdown(nodes: CommandNodeDescriptor[], parent: string[] = []): string[] {
	return nodes.flatMap((node) => {
		const path = [...parent, node.segment];
		if (node.nodeType === 'branch') return [`## trsd ${path.join(' ')}`, '', node.description, '', ...markdown(node.children, path)];
		const args = (node.arguments ?? []).map((argument) => ` <${argument.name}>`).join('');
		const options = (node.options ?? []).map((option) => `- \`${option.name}\`: ${option.description}`);
		return [
			`### trsd ${path.join(' ')}${args}`,
			'', node.description, '',
			`Operation: ${node.kind}. Result schema: \`${node.resultSchemaId}\`.`,
			...(options.length ? ['', ...options] : []), '',
		];
	});
}

const reference = [
	'# TreeSeed CLI command reference', '',
	'This file is generated from the accepted `@treeseed/sdk/operator-contracts` command tree. Do not edit it by hand.', '',
	...markdown(TREESEED_COMMAND_TREE_V1.commands),
].join('\n');

const bash = [
	'# Generated from treeseed.command-tree/v1.',
	'_trsd_complete() {',
	`  local paths=${JSON.stringify(paths.join('\n'))}`,
	'  COMPREPLY=( $(compgen -W "$paths" -- "${COMP_WORDS[*]:1}") )',
	'}',
	'complete -F _trsd_complete trsd',
	'',
].join('\n');

const commandResultSchema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	$id: 'https://schemas.treeseed.dev/cli/command-result-v1.json',
	title: 'TreeSeed command result',
	type: 'object',
	required: ['schemaVersion', 'commandPath', 'mode', 'ok', 'result', 'error', 'warnings', 'blockers', 'receipts', 'nextActions'],
	properties: {
		schemaVersion: { const: 'treeseed.command-result/v1' },
		commandPath: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[a-z][a-z0-9]*$' } },
		mode: { enum: ['execute', 'plan'] }, ok: { type: 'boolean' }, result: {},
		error: { anyOf: [{ type: 'null' }, { type: 'object', required: ['category', 'code', 'message'] }] },
		warnings: { type: 'array', items: { type: 'string' } },
		blockers: { type: 'array', items: { type: 'object', required: ['code', 'message'] } },
		receipts: { type: 'array', items: { type: 'object', required: ['kind', 'id'] } },
		nextActions: { type: 'array', items: { type: 'string' } },
	},
	additionalProperties: false,
};
const commandTreeSchema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	$id: 'https://schemas.treeseed.dev/cli/command-tree-v1.json',
	title: 'TreeSeed command tree', type: 'object',
	required: ['schemaVersion', 'executable', 'commands'],
	properties: {
		schemaVersion: { const: 'treeseed.command-tree/v1' }, executable: { const: 'trsd' },
		commands: { type: 'array', items: { $ref: '#/$defs/node' } },
	},
	$defs: {
		node: { type: 'object', required: ['nodeType', 'segment', 'description'], properties: { nodeType: { enum: ['branch', 'leaf'] }, segment: { type: 'string', pattern: '^[a-z][a-z0-9]*$' }, description: { type: 'string' }, children: { type: 'array', items: { $ref: '#/$defs/node' } }, kind: { enum: ['read', 'mutation'] }, resultSchemaId: { type: 'string' } } },
	},
};

await Promise.all([
	mkdir(resolve(root, 'docs'), { recursive: true }),
	mkdir(resolve(root, 'schemas'), { recursive: true }),
	mkdir(resolve(root, 'completions'), { recursive: true }),
]);
await Promise.all([
	writeFile(resolve(root, 'docs', 'command-reference.md'), reference),
	writeFile(resolve(root, 'schemas', 'command-tree.json'), `${JSON.stringify(TREESEED_COMMAND_TREE_V1, null, 2)}\n`),
	writeFile(resolve(root, 'schemas', 'command-tree.schema.json'), `${JSON.stringify(commandTreeSchema, null, 2)}\n`),
	writeFile(resolve(root, 'schemas', 'command-result.schema.json'), `${JSON.stringify(commandResultSchema, null, 2)}\n`),
	writeFile(resolve(root, 'completions', 'trsd.bash'), bash),
]);
