import {
	findOperation as findSdkOperation,
	TRESEED_OPERATION_SPECS as SDK_OPERATION_SPECS,
} from '@treeseed/sdk/operations';
import type { OperationMetadata } from '@treeseed/sdk/operations';
import type { OperationSpec } from './operations-types.ts';
import { mergeHelpSpec, type CommandOverlay } from './operations-registry-support.ts';
import { taskLifecycleCommandOverlays } from '../support/overlays-task-lifecycle.ts';
import { stagingAndReleaseCommandOverlays } from '../packages/overlays-staging-and-release.ts';
import { recoveryAndWorkspaceCommandOverlays } from '../treedx/workspaces/overlays-recovery-and-workspace.ts';
import { authenticationAndSecretsCommandOverlays } from '../accounts/overlays-authentication-and-secrets.ts';
import { projectBootstrapCommandOverlays } from '../projects/projects-core/overlays-project-bootstrap.ts';
import { configurationCommandOverlays } from '../configuration/overlays-configuration.ts';
import { localDevelopmentCommandOverlays } from '../runtime/overlays-local-development.ts';
import { validationAndPassthroughCommandOverlays } from '../support/overlays-validation-and-passthrough.ts';
import { localDevelopmentOperationSpecs } from './operations-local-development.ts';
import { scenesAndGuaranteesOperationSpecs } from '../scenes/operations-scenes-and-guarantees.ts';
import { seedAndDemoOperationSpecs } from '../seeds/operations-seed-and-demo.ts';
import { hostingAndReconciliationOperationSpecs } from '../reconciliation/operations-hosting-and-reconciliation.ts';
import { providerToolsOperationSpecs } from '../capacity/providers/operations-provider-tools.ts';
import { marketProjectsOperationSpecs } from '../projects/projects-core/operations-market-projects.ts';
import { capacityOperationSpecs } from '../capacity/capacity-core/operations-capacity.ts';
import { operationsAndReadinessOperationSpecs } from './operations-operations-and-readiness.ts';
import { packageAndWorkflowOperationSpecs } from './operations-package-and-workflow.ts';
import { treedxAndPacksOperationSpecs } from '../treedx/repositories/operations-treedx-and-packs.ts';
import { agentRuntimeOperationSpecs } from './operations-agent-runtime.ts';

const CLI_COMMAND_OVERLAYS = new Map<string, CommandOverlay>([
	...taskLifecycleCommandOverlays,
	...stagingAndReleaseCommandOverlays,
	...recoveryAndWorkspaceCommandOverlays,
	...authenticationAndSecretsCommandOverlays,
	...projectBootstrapCommandOverlays,
	...configurationCommandOverlays,
	...localDevelopmentCommandOverlays,
	...validationAndPassthroughCommandOverlays,
]);
const CLI_ONLY_OPERATION_SPECS = [
	...localDevelopmentOperationSpecs,
	...scenesAndGuaranteesOperationSpecs,
	...seedAndDemoOperationSpecs,
	...hostingAndReconciliationOperationSpecs,
	...providerToolsOperationSpecs,
	...marketProjectsOperationSpecs,
	...capacityOperationSpecs,
	...operationsAndReadinessOperationSpecs,
	...packageAndWorkflowOperationSpecs,
	...treedxAndPacksOperationSpecs,
	...agentRuntimeOperationSpecs,
];

function mergeOperationSpec(metadata: OperationMetadata): OperationSpec {
	const overlay = CLI_COMMAND_OVERLAYS.get(metadata.name) ?? {};
	const specWithoutHelp: Omit<OperationSpec, 'help'> = {
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

export const TRESEED_OPERATION_SPECS: OperationSpec[] = [
	...SDK_OPERATION_SPECS.map(mergeOperationSpec),
	...CLI_ONLY_OPERATION_SPECS,
];
export const TRESEED_OPERATION_INDEX = new Map<string, OperationSpec>();
for (const spec of TRESEED_OPERATION_SPECS) {
	TRESEED_OPERATION_INDEX.set(spec.name, spec);
	for (const alias of spec.aliases) TRESEED_OPERATION_INDEX.set(alias, spec);
}
export function findOperation(name: string | null | undefined) {
	if (!name) return null;
	const directMatch = TRESEED_OPERATION_INDEX.get(name);
	if (directMatch) return directMatch;
	const metadata = findSdkOperation(name);
	return metadata ? (TRESEED_OPERATION_INDEX.get(metadata.name) ?? mergeOperationSpec(metadata)) : null;
}
export function listOperationNames() {
	return [...new Set(TRESEED_OPERATION_SPECS.map((spec) => spec.name))];
}
