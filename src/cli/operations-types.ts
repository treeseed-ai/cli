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

export type TreeseedOperationId =
	| 'workspace.status'
	| 'workspace.doctor'
	| 'branch.tasks'
	| 'branch.switch'
	| 'branch.save'
	| 'branch.close'
	| 'branch.stage'
	| 'deploy.release'
	| 'deploy.rollback'
	| 'deploy.destroy'
	| 'template.list'
	| 'template.show'
	| 'template.validate'
	| 'template.sync'
	| 'project.init'
	| 'project.config'
	| 'local.dev'
	| 'local.devWatch'
	| 'local.build'
	| 'local.check'
	| 'local.preview'
	| 'local.lint'
	| 'local.test'
	| 'validation.testUnit'
	| 'validation.preflight'
	| 'validation.authCheck'
	| 'auth.login'
	| 'auth.logout'
	| 'auth.whoami'
	| 'release.testE2e'
	| 'release.testE2eLocal'
	| 'release.testE2eStaging'
	| 'release.testE2eFull'
	| 'release.testFast'
	| 'release.verify'
	| 'release.publishChanged'
	| 'services.mailpitUp'
	| 'services.mailpitDown'
	| 'services.mailpitLogs'
	| 'data.d1MigrateLocal'
	| 'content.cleanupMarkdown'
	| 'content.cleanupMarkdownCheck'
	| 'tools.astro'
	| 'tools.syncDevvars'
	| 'tools.starlightPatch'
	| 'agents.run';

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

export type TreeseedPromptHandler = (message: string) => Promise<string> | string;
export type TreeseedConfirmHandler = (message: string, expected: string) => Promise<boolean> | boolean;

export type TreeseedCommandContext = {
	cwd: string;
	env: NodeJS.ProcessEnv;
	write: TreeseedWriter;
	spawn: TreeseedSpawner;
	outputFormat?: 'human' | 'json';
	prompt?: TreeseedPromptHandler;
	confirm?: TreeseedConfirmHandler;
};

export type TreeseedCommandHandler = (
	invocation: TreeseedParsedInvocation,
	context: TreeseedCommandContext,
) => Promise<TreeseedCommandResult> | TreeseedCommandResult;

export type TreeseedAdapterSpec = {
	script: string;
	workspaceScript?: string;
	directScript?: string;
	extraArgs?: string[];
	rewriteArgs?: (args: string[]) => string[];
	passthroughArgs?: boolean;
	requireWorkspaceRoot?: boolean;
};

export type TreeseedOperationSpec = {
	id: TreeseedOperationId;
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
	adapter?: TreeseedAdapterSpec;
};

export type TreeseedOperationRequest = {
	commandName: string;
	argv?: string[];
};

export type TreeseedOperationResult = TreeseedCommandResult & {
	operation: TreeseedOperationId;
	ok: boolean;
	payload?: Record<string, unknown> | null;
	meta?: Record<string, unknown>;
	nextSteps?: string[];
};

export type TreeseedOperationExecutor = (
	spec: TreeseedOperationSpec,
	argv: string[],
	context: TreeseedCommandContext,
) => Promise<number> | number;

export type TreeseedHandlerResolver = (handlerName: string) => TreeseedCommandHandler | null;

export type TreeseedAdapterResolverResult =
	| {
		scriptPath: string;
		extraArgs: string[];
		rewriteArgs?: (args: string[]) => string[];
	}
	| {
		error: string;
	};

export type TreeseedAdapterResolver = (
	spec: TreeseedOperationSpec,
	cwd: string,
) => TreeseedAdapterResolverResult;
