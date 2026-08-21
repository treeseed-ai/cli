import {
	TREESEED_COMMAND_TREE_V1,
	type CommandLeafDescriptor,
	type CommandNodeDescriptor,
} from '@treeseed/sdk/operator-contracts';
import type { OperationSpec } from './operations-types.ts';
import { canonicalOperationSpecs } from './operations-canonical.ts';

function flattenLeafPaths(nodes: CommandNodeDescriptor[], parent: string[] = []): Array<{ path: string[]; leaf: CommandLeafDescriptor }> {
	return nodes.flatMap((node) => {
		const path = [...parent, node.segment];
		return node.nodeType === 'leaf' ? [{ path, leaf: node }] : flattenLeafPaths(node.children, path);
	});
}

const contractPaths = flattenLeafPaths(TREESEED_COMMAND_TREE_V1.commands).map(({ path }) => path.join(' '));
const implementedPaths = canonicalOperationSpecs.map((spec) => spec.name);
if (contractPaths.length !== implementedPaths.length || contractPaths.some((path, index) => path !== implementedPaths[index])) {
	throw new Error('The CLI command registry does not exactly implement the accepted SDK command tree.');
}

export const TRESEED_OPERATION_SPECS: OperationSpec[] = canonicalOperationSpecs;
export const TRESEED_OPERATION_INDEX = new Map<string, OperationSpec>();
for (const spec of TRESEED_OPERATION_SPECS) {
	TRESEED_OPERATION_INDEX.set(spec.name, spec);
}
export function findOperation(name: string | null | undefined) {
	if (!name) return null;
	return TRESEED_OPERATION_INDEX.get(name) ?? null;
}
export function listOperationNames() {
	return [...new Set(TRESEED_OPERATION_SPECS.map((spec) => spec.name))];
}
