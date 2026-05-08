import {
	findTreeseedOperation,
	listTreeseedOperationNames,
	TRESEED_OPERATION_SPECS,
} from './operations-registry.js';
import type { TreeseedCommandSpec } from './operations-types.js';
import { handleInit } from './handlers/init.js';
import { handleConfig } from './handlers/config.js';
import { handleClose } from './handlers/close.js';
import { handleSave } from './handlers/save.js';
import { handleRelease } from './handlers/release.js';
import { handleDestroy } from './handlers/destroy.js';
import { handleStatus } from './handlers/status.js';
import { handleCi } from './handlers/ci.js';
import { handleDev } from './handlers/dev.js';
import { handleDoctor } from './handlers/doctor.js';
import { handleRollback } from './handlers/rollback.js';
import { handleTemplate } from './handlers/template.js';
import { handleSync } from './handlers/sync.js';
import { handleAuthLogin } from './handlers/auth-login.js';
import { handleAuthLogout } from './handlers/auth-logout.js';
import { handleAuthWhoAmI } from './handlers/auth-whoami.js';
import { handleMarket } from './handlers/market.js';
import { handleTeams } from './handlers/teams.js';
import { handleProjects } from './handlers/projects.js';
import { handlePacks } from './handlers/packs.js';
import { handleToolWrapper } from './handlers/tool-wrapper.js';
import {
	handleSecretsLock,
	handleSecretsMigrateKey,
	handleSecretsRotateMachineKey,
	handleSecretsRotatePassphrase,
	handleSecretsStatus,
	handleSecretsUnlock,
} from './handlers/secrets.js';
import { handleTasks } from './handlers/tasks.js';
import { handleSwitch } from './handlers/switch.js';
import { handleStage } from './handlers/stage.js';
import { handleTagsCleanup } from './handlers/tags-cleanup.js';
import { handleExport } from './handlers/export.js';
import { handleResume } from './handlers/resume.js';
import { handleRecover } from './handlers/recover.js';
import { handleWorkspace } from './handlers/workspace.js';

const workspaceCommand = (name: 'status' | 'link' | 'unlink') => `workspace${':'}${name}`;

export const COMMAND_HANDLERS = {
	init: handleInit,
	config: handleConfig,
	close: handleClose,
	save: handleSave,
	release: handleRelease,
	destroy: handleDestroy,
	status: handleStatus,
	ci: handleCi,
	dev: handleDev,
	'dev:watch': handleDev,
	doctor: handleDoctor,
	rollback: handleRollback,
	template: handleTemplate,
	sync: handleSync,
	tasks: handleTasks,
	switch: handleSwitch,
	stage: handleStage,
	'tags:cleanup': handleTagsCleanup,
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
	packs: handlePacks,
	gh: handleToolWrapper,
	railway: handleToolWrapper,
	wrangler: handleToolWrapper,
	'secrets:status': handleSecretsStatus,
	'secrets:unlock': handleSecretsUnlock,
	'secrets:lock': handleSecretsLock,
	'secrets:migrate-key': handleSecretsMigrateKey,
	'secrets:rotate-passphrase': handleSecretsRotatePassphrase,
	'secrets:rotate-machine-key': handleSecretsRotateMachineKey,
} as const;

export const TRESEED_COMMAND_SPECS: TreeseedCommandSpec[] = TRESEED_OPERATION_SPECS;

export function findCommandSpec(name: string | null | undefined) {
	return findTreeseedOperation(name);
}

export function listCommandNames() {
	return listTreeseedOperationNames();
}
