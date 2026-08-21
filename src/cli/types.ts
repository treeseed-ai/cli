import type { CommandErrorCategory } from '@treeseed/sdk/operator-contracts';

export type OutputFormat = 'human' | 'json';
export type Writer = (output: string, stream?: 'stdout' | 'stderr') => void;

export interface CommandContext {
	cwd: string;
	env: NodeJS.ProcessEnv;
	write: Writer;
	outputFormat: OutputFormat;
	interactiveUi: boolean;
	prompt?: (question: string) => Promise<string> | string;
	confirm?: (question: string, defaultValue?: 'yes' | 'no') => Promise<boolean> | boolean;
	apiRequest?: (path: string, body: unknown) => Promise<unknown>;
}

export interface OptionSpec {
	name: string;
	flag: string;
	kind: 'boolean' | 'string';
	repeatable?: boolean;
	description: string;
}

export interface CommandSpec {
	path: string[];
	name: string;
	description: string;
	kind: 'read' | 'mutation';
	arguments: Array<{ name: string; description: string; required: boolean }>;
	options: OptionSpec[];
	confirmation: 'never' | 'destructive' | 'credential' | 'authority' | 'production' | 'irreversible';
}

export interface ParsedInvocation {
	command: CommandSpec;
	arguments: string[];
	options: Record<string, string | string[] | boolean | undefined>;
}

export interface CommandFailure {
	category: CommandErrorCategory;
	code: string;
	message: string;
}
