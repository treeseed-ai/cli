import type { UiViewportLayout } from '../ui/framework.js';

import { useTerminalMouse } from '../ui/mouse.js';

export type ConfigScope = 'local' | 'staging' | 'prod';
export type ConfigViewMode = 'startup' | 'full';
export type ConfigFocusArea = 'environment' | 'filter' | 'sidebar' | 'content' | 'actions';
export type ConfigValidation =
	| { kind: 'string' | 'nonempty' | 'boolean' | 'number' | 'url' | 'email'; minLength?: number }
	| { kind: 'enum'; values: string[] };

export type ConfigEntry = {
	id: string;
	label: string;
	group: string;
	cluster: string;
	startupProfile: 'core' | 'optional' | 'advanced';
	requirement: 'required' | 'conditional' | 'optional' | 'generated';
	description: string;
	howToGet: string;
	sensitivity: 'secret' | 'plain' | 'derived';
	targets: string[];
	purposes: string[];
	storage: 'shared' | 'scoped';
	validation?: ConfigValidation;
	sourceRequirement?: string;
	sourceHostType?: string | null;
	sourceProvider?: string | null;
	scope: Exclude<ConfigScope, 'all'>;
	sharedScopes: Array<Exclude<ConfigScope, 'all'>>;
	required: boolean;
	currentValue: string;
	suggestedValue: string;
	effectiveValue: string;
};

export type ConfigContextSnapshot = {
	project: {
		name: string;
		slug: string;
	};
	scopes: Array<Exclude<ConfigScope, 'all'>>;
	entriesByScope: Record<Exclude<ConfigScope, 'all'>, ConfigEntry[]>;
	configReadinessByScope: Record<Exclude<ConfigScope, 'all'>, {
		github: { configured: boolean };
		cloudflare: { configured: boolean };
		railway: { configured: boolean };
		localDevelopment: { configured: boolean };
	}>;
};

export type ConfigPage = {
	kind: 'entry';
	key: string;
	entry: ConfigEntry;
	scope: ConfigScope;
	scopes: ConfigScope[];
	requiredScopes: ConfigScope[];
	required: boolean;
	currentValue: string;
	suggestedValue: string;
	finalValue: string;
	wizardRequiredMissing: boolean;
};

export type ConfigWizardStep = ConfigPage & {
	index: number;
	total: number;
};

export type ConfigEditorResult = {
	overrides: Record<string, string>;
	viewMode: ConfigViewMode;
};

export type ConfigCommitUpdate = {
	scope: Exclude<ConfigScope, 'all'>;
	entryId: string;
	value: string;
};

export type ConfigEditorOptions = {
	initialViewMode?: ConfigViewMode;
	mouseEnabled?: boolean;
	initialStatusMessage?: string;
	toolAvailability?: {
		githubCli?: { available: boolean };
		wranglerCli?: { available: boolean };
		railwayCli?: { available: boolean };
		ghActExtension?: { available: boolean };
		dockerDaemon?: { available: boolean };
	};
	secretSession?: {
		status?: { unlocked?: boolean };
		createdWrappedKey?: boolean;
		migratedWrappedKey?: boolean;
		unlockSource?: string;
	};
	onCommit?: (update: ConfigCommitUpdate) => Promise<ConfigContextSnapshot> | ConfigContextSnapshot;
};

export type ConfigInputState = {
	value: string;
	cursor: number;
};

export type ConfigViewportLayout = UiViewportLayout & {
	sidebarWidth: number;
	contentWidth: number;
	detailHeight: number;
	detailViewportHeight: number;
	inputHeight: number;
	actionRowHeight: number;
};
