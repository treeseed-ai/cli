import {
	findTreeseedOperation as findSdkOperation,
	TRESEED_OPERATION_SPECS as SDK_OPERATION_SPECS,
} from '@treeseed/sdk/operations';
import type { TreeseedOperationMetadata } from '@treeseed/sdk/operations';
import type { TreeseedOperationSpec } from './operations-types.ts';
import { mergeHelpSpec, type CommandOverlay } from './operations-registry-support.ts';
import { CLI_COMMAND_OVERLAYS_1 } from './operations-registry-overlays-1.ts';
import { CLI_COMMAND_OVERLAYS_2 } from './operations-registry-overlays-2.ts';
import { CLI_COMMAND_OVERLAYS_3 } from './operations-registry-overlays-3.ts';
import { CLI_COMMAND_OVERLAYS_4 } from './operations-registry-overlays-4.ts';
import { CLI_ONLY_OPERATION_SPECS_1 } from './operations-registry-cli-1.ts';
import { CLI_ONLY_OPERATION_SPECS_2 } from './operations-registry-cli-2.ts';
import { CLI_ONLY_OPERATION_SPECS_3 } from './operations-registry-cli-3.ts';
import { CLI_ONLY_OPERATION_SPECS_4 } from './operations-registry-cli-4.ts';

const CLI_COMMAND_OVERLAYS = new Map<string, CommandOverlay>([
	...CLI_COMMAND_OVERLAYS_1,
	...CLI_COMMAND_OVERLAYS_2,
	...CLI_COMMAND_OVERLAYS_3,
	...CLI_COMMAND_OVERLAYS_4,
]);
const CLI_ONLY_OPERATION_SPECS = [
	...CLI_ONLY_OPERATION_SPECS_1,
	...CLI_ONLY_OPERATION_SPECS_2,
	...CLI_ONLY_OPERATION_SPECS_3,
	...CLI_ONLY_OPERATION_SPECS_4,
];

function mergeOperationSpec(metadata: TreeseedOperationMetadata): TreeseedOperationSpec {
	const overlay = CLI_COMMAND_OVERLAYS.get(metadata.name) ?? {};
	const specWithoutHelp: Omit<TreeseedOperationSpec, 'help'> = {
		...metadata,
		usage: overlay.usage,
		arguments: overlay.arguments,
		options: overlay.options,
		examples: overlay.examples,
		notes: overlay.notes,
		helpVisible: overlay.helpVisible ?? true,
		helpFeatured: overlay.helpFeatured ?? metadata.group === 'Workflow',
		executionMode: overlay.executionMode ?? 'adapter',
		handlerName: overlay.handlerName,
		delegateTo: overlay.delegateTo,
		buildAdapterInput: overlay.buildAdapterInput,
	};
	return { ...specWithoutHelp, help: mergeHelpSpec(metadata, overlay, specWithoutHelp) };
}

export const TRESEED_OPERATION_SPECS: TreeseedOperationSpec[] = [
	...SDK_OPERATION_SPECS.map(mergeOperationSpec),
	...CLI_ONLY_OPERATION_SPECS,
];
export const TRESEED_OPERATION_INDEX = new Map<string, TreeseedOperationSpec>();
for (const spec of TRESEED_OPERATION_SPECS) {
	TRESEED_OPERATION_INDEX.set(spec.name, spec);
	for (const alias of spec.aliases) TRESEED_OPERATION_INDEX.set(alias, spec);
}
export function findTreeseedOperation(name: string | null | undefined) {
	if (!name) return null;
	const directMatch = TRESEED_OPERATION_INDEX.get(name);
	if (directMatch) return directMatch;
	const metadata = findSdkOperation(name);
	return metadata ? (TRESEED_OPERATION_INDEX.get(metadata.name) ?? mergeOperationSpec(metadata)) : null;
}
export function listTreeseedOperationNames() {
	return [...new Set(TRESEED_OPERATION_SPECS.map((spec) => spec.name))];
}
