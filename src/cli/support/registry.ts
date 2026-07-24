import {
	findOperation,
	listOperationNames,
	TRESEED_OPERATION_SPECS,
} from '../operations/operations-registry.js';
import type { CommandSpec } from '../operations/operations-types.js';
import { handleInit } from '../handlers/utilities/init.js';
import { handleConfig } from '../handlers/configuration/config.js';
import { handleClose } from '../handlers/workspace-lifecycle/close.js';
import { handleSave } from '../handlers/workspace-lifecycle/save.js';
import { handleUpdate } from '../handlers/workspace-lifecycle/update.js';
import { handleRelease } from '../handlers/packages/release.js';
import { handleReleaseCandidate } from '../handlers/packages/release-candidate.js';
import { handleProof } from '../handlers/guarantees/proof.js';
import { handleDestroy } from '../handlers/workspace-lifecycle/destroy.js';
import { handleStatus } from '../handlers/diagnostics/status.js';
import { handleCi } from '../handlers/diagnostics/ci.js';
import { handleDev } from '../handlers/runtime/dev.js';
import { handleDoctor } from '../handlers/diagnostics/doctor.js';
import { handleRollback } from '../handlers/workspace-lifecycle/rollback.js';
import { handleTemplate } from '../handlers/content/template.js';
import { handleSync } from '../handlers/content/sync.js';
import { handleAuthLogin } from '../handlers/accounts/auth-login.js';
import { handleAuthLogout } from '../handlers/accounts/auth-logout.js';
import { handleAuthWhoAmI } from '../handlers/accounts/auth-whoami.js';
import { handleMarket } from '../handlers/content/market.js';
import { handleTeams } from '../handlers/teams/teams.js';
import { handleProjects } from '../handlers/projects/projects-core/projects.js';
import { handleCapacity } from '../handlers/capacity/capacity-core/capacity.js';
import { handlePackage } from '../handlers/packages/package.js';
import { handleTreeDx } from '../handlers/treedx/repositories/treedx.js';
import { handleHosting } from '../handlers/hosting/hosting.js';
import { handleReconcile } from '../handlers/reconciliation/reconcile.js';
import { handleReady } from '../handlers/diagnostics/ready.js';
import { handleOperations } from '../handlers/operations/operations.js';
import { handlePacks } from '../handlers/content/packs.js';
import { handleToolWrapper } from '../handlers/agents/tool-wrapper.js';
import { handleWorkflow } from '../handlers/operations/workflow-dispatch.js';
import {
	handleSecretsLock,
	handleSecretsMigrateKey,
	handleSecretsRotateMachineKey,
	handleSecretsRotatePassphrase,
	handleSecretsStatus,
	handleSecretsUnlock,
} from '../handlers/configuration/secrets.js';
import { handleTasks } from '../handlers/utilities/tasks.js';
import { handleSwitch } from '../handlers/workspace-lifecycle/switch.js';
import { handleStage } from '../handlers/workspace-lifecycle/stage.js';
import { handleExport } from '../handlers/content/export.js';
import { handleResume } from '../handlers/workspace-lifecycle/resume.js';
import { handleRecover } from '../handlers/workspace-lifecycle/recover.js';
import { handleWorkspace } from '../handlers/treedx/workspaces/workspace.js';
import { handleAudit } from '../handlers/diagnostics/audit.js';
import { handleSeed } from '../handlers/seeds/seed.js';
import { handleDemo } from '../handlers/content/demo.js';
import { handleScene } from '../handlers/scenes/scene.js';
import { handleGuarantees } from '../handlers/guarantees/guarantees.js';
import { handleCleanup } from '../handlers/diagnostics/cleanup.js';

const workspaceCommand = (name: 'status' | 'link' | 'unlink') => `workspace${':'}${name}`;

export const COMMAND_HANDLERS = {
	init: handleInit,
	config: handleConfig,
	close: handleClose,
	save: handleSave,
	update: handleUpdate,
	release: handleRelease,
	destroy: handleDestroy,
	status: handleStatus,
	ci: handleCi,
	dev: handleDev,
	doctor: handleDoctor,
	rollback: handleRollback,
	template: handleTemplate,
	sync: handleSync,
	tasks: handleTasks,
	switch: handleSwitch,
	stage: handleStage,
	'release-candidate': handleReleaseCandidate,
	proof: handleProof,
	resume: handleResume,
	recover: handleRecover,
	[workspaceCommand('status')]: handleWorkspace,
	[workspaceCommand('link')]: handleWorkspace,
	[workspaceCommand('unlink')]: handleWorkspace,
	export: handleExport,
	'auth:login': handleAuthLogin,
	'auth:logout': handleAuthLogout,
	'auth:whoami': handleAuthWhoAmI,
	market: handleMarket,
	teams: handleTeams,
	projects: handleProjects,
	capacity: handleCapacity,
	package: handlePackage,
	db: handleTreeDx,
	hosting: handleHosting,
	reconcile: handleReconcile,
	ready: handleReady,
	operations: handleOperations,
	workflow: handleWorkflow,
	packs: handlePacks,
	gh: handleToolWrapper,
	railway: handleToolWrapper,
	wrangler: handleToolWrapper,
	docker: handleToolWrapper,
	'secrets:status': handleSecretsStatus,
	'secrets:unlock': handleSecretsUnlock,
	'secrets:lock': handleSecretsLock,
	'secrets:migrate-key': handleSecretsMigrateKey,
	'secrets:rotate-passphrase': handleSecretsRotatePassphrase,
	'secrets:rotate-machine-key': handleSecretsRotateMachineKey,
	audit: handleAudit,
	seed: handleSeed,
	demo: handleDemo,
	scene: handleScene,
	guarantees: handleGuarantees,
	cleanup: handleCleanup,
} as const;

export const TRESEED_COMMAND_SPECS: CommandSpec[] = TRESEED_OPERATION_SPECS;

export function findCommandSpec(name: string | null | undefined) {
	return findOperation(name);
}

export function listCommandNames() {
	return listOperationNames();
}
