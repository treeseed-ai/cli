import type { CommandErrorCategory, CommandExecutionBinding } from '@treeseed/sdk/operator-contracts';

export type OutputFormat = 'human' | 'json';
export type Writer = (output: string, stream?: 'stdout' | 'stderr') => void;

export interface CommandContext {
	cwd: string;
	env: NodeJS.ProcessEnv;
	write: Writer;
	outputFormat: OutputFormat;
	interactiveUi: boolean;
	prompt?: (question: string) => Promise<string> | string;
	promptSecret?: (question: string) => Promise<string> | string;
	confirm?: (question: string, defaultValue?: 'yes' | 'no') => Promise<boolean> | boolean;
	operationInvoke?: (operationId: string, input: unknown) => Promise<unknown>;
	hostInvoke?: (input: { handlerId: string; arguments: string[]; options: Record<string, string | string[] | boolean | undefined> }) => Promise<unknown>;
	providerEnrollmentHandoff?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface OptionSpec {
	name: string;
	flag: string;
	kind: 'boolean' | 'string' | 'number' | 'string[]';
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
	execution: CommandExecutionBinding;
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
