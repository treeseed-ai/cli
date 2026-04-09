import {
	findTreeseedOperation,
	listTreeseedOperationNames,
	TRESEED_OPERATION_SPECS,
	type TreeseedCommandSpec,
} from '@treeseed/sdk/operations';
import { handleInit } from './handlers/init.js';
import { handleConfig } from './handlers/config.js';
import { handleStart } from './handlers/start.js';
import { handleClose } from './handlers/close.js';
import { handleDeploy } from './handlers/deploy.js';
import { handleSave } from './handlers/save.js';
import { handleRelease } from './handlers/release.js';
import { handleDestroy } from './handlers/destroy.js';
import { handleStatus } from './handlers/status.js';
import { handleNext } from './handlers/next.js';
import { handleDoctor } from './handlers/doctor.js';
import { handleSetup } from './handlers/setup.js';
import { handleWork } from './handlers/work.js';
import { handleShip } from './handlers/ship.js';
import { handlePrepare } from './handlers/prepare.js';
import { handlePublish } from './handlers/publish.js';
import { handlePromote } from './handlers/promote.js';
import { handleTeardown } from './handlers/teardown.js';
import { handleContinue } from './handlers/continue.js';
import { handleRollback } from './handlers/rollback.js';
import { handleTemplate } from './handlers/template.js';
import { handleSync } from './handlers/sync.js';

export const COMMAND_HANDLERS = {
	init: handleInit,
	config: handleConfig,
	start: handleStart,
	close: handleClose,
	deploy: handleDeploy,
	save: handleSave,
	release: handleRelease,
	destroy: handleDestroy,
	status: handleStatus,
	next: handleNext,
	doctor: handleDoctor,
	setup: handleSetup,
	work: handleWork,
	ship: handleShip,
	prepare: handlePrepare,
	publish: handlePublish,
	promote: handlePromote,
	teardown: handleTeardown,
	continue: handleContinue,
	rollback: handleRollback,
	template: handleTemplate,
	sync: handleSync,
} as const;

export const TRESEED_COMMAND_SPECS: TreeseedCommandSpec[] = TRESEED_OPERATION_SPECS;

export function findCommandSpec(name: string | null | undefined) {
	return findTreeseedOperation(name);
}

export function listCommandNames() {
	return listTreeseedOperationNames();
}
