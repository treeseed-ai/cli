export type TreeseedCommandGroup =
	| 'Workflow'
	| 'Local Development'
	| 'Validation'
	| 'Release Utilities'
	| 'Utilities'
	| 'Passthrough';

export type TreeseedExecutionMode = 'handler' | 'adapter';
export type TreeseedArgumentKind = 'positional' | 'message_tail';
export type TreeseedOptionKind = 'boolean' | 'string' | 'enum';

export type TreeseedCommandArgumentSpec = {
	name: string;
	description: string;
	required?: boolean;
	kind?: TreeseedArgumentKind;
};

export type TreeseedCommandOptionSpec = {
	name: string;
	flags: string;
	description: string;
	kind: TreeseedOptionKind;
	repeatable?: boolean;
	values?: string[];
};

export type TreeseedCommandExample = string;

export type TreeseedParsedInvocation = {
	commandName: string;
	args: Record<string, string | string[] | boolean | undefined>;
	positionals: string[];
	rawArgs: string[];
};

export type TreeseedCommandResult = {
	exitCode?: number;
	stdout?: string[];
	stderr?: string[];
	report?: Record<string, unknown> | null;
};

export type TreeseedWriter = (output: string, stream?: 'stdout' | 'stderr') => void;
export type TreeseedSpawner = (
	command: string,
	args: string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		stdio?: 'inherit';
	},
) => { status?: number | null };

export type TreeseedCommandContext = {
	cwd: string;
	env: NodeJS.ProcessEnv;
	write: TreeseedWriter;
	spawn: TreeseedSpawner;
	outputFormat?: 'human' | 'json';
};

export type TreeseedCommandHandler = (
	invocation: TreeseedParsedInvocation,
	context: TreeseedCommandContext,
) => Promise<TreeseedCommandResult> | TreeseedCommandResult;

export type TreeseedCommandSpec = {
	name: string;
	aliases: string[];
	group: TreeseedCommandGroup;
	summary: string;
	description: string;
	usage?: string;
	arguments?: TreeseedCommandArgumentSpec[];
	options?: TreeseedCommandOptionSpec[];
	examples?: TreeseedCommandExample[];
	notes?: string[];
	related?: string[];
	executionMode: TreeseedExecutionMode;
	handlerName?: string;
	adapter?: {
		script: string;
		workspaceScript?: string;
		directScript?: string;
		extraArgs?: string[];
		rewriteArgs?: (args: string[]) => string[];
		passthroughArgs?: boolean;
		requireWorkspaceRoot?: boolean;
	};
};
