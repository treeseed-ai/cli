import type {
	TreeseedOperationContext as SdkOperationContext,
	TreeseedOperationGroup,
	TreeseedOperationId,
	TreeseedOperationMetadata,
	TreeseedOperationResult as SdkOperationResult,
} from '@treeseed/sdk/operations';

export type TreeseedCommandGroup = TreeseedOperationGroup;

export type TreeseedExecutionDelegate = 'agents';
export type TreeseedExecutionMode = 'handler' | 'adapter' | 'delegate';
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

export type TreeseedStructuredCommandExample = {
	command: string;
	title: string;
	description: string;
	result?: string;
	why?: string;
};

export type TreeseedCommandExample = string | TreeseedStructuredCommandExample;

export type TreeseedCommandHelpDetail = {
	name: string;
	detail: string;
};

export type TreeseedCommandRelatedDetail = {
	name: string;
	why: string;
};

export type TreeseedCommandHelpSpec = {
	workflowPosition?: string;
	longSummary?: string[];
	whenToUse?: string[];
	beforeYouRun?: string[];
	outcomes?: string[];
	examples?: TreeseedStructuredCommandExample[];
	optionDetails?: TreeseedCommandHelpDetail[];
	argumentDetails?: TreeseedCommandHelpDetail[];
	automationNotes?: string[];
	warnings?: string[];
	relatedDetails?: TreeseedCommandRelatedDetail[];
	seeAlso?: string[];
};

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

export type TreeseedWriter = NonNullable<SdkOperationContext['write']>;
export type TreeseedSpawner = NonNullable<SdkOperationContext['spawn']>;
export type TreeseedPromptHandler = NonNullable<SdkOperationContext['prompt']>;
export type TreeseedConfirmHandler = NonNullable<SdkOperationContext['confirm']>;

export type TreeseedCommandContext = {
	cwd: string;
	env: NodeJS.ProcessEnv;
	write: TreeseedWriter;
	spawn: TreeseedSpawner;
	outputFormat?: 'human' | 'json';
	interactiveUi?: boolean;
	prompt?: TreeseedPromptHandler;
	confirm?: TreeseedConfirmHandler;
};

export type TreeseedCommandHandler = (
	invocation: TreeseedParsedInvocation,
	context: TreeseedCommandContext,
) => Promise<TreeseedCommandResult> | TreeseedCommandResult;

export type TreeseedAdapterInputBuilder = (
	invocation: TreeseedParsedInvocation,
	context: TreeseedCommandContext,
) => Record<string, unknown>;

export type TreeseedOperationSpec = TreeseedOperationMetadata & {
	usage?: string;
	arguments?: TreeseedCommandArgumentSpec[];
	options?: TreeseedCommandOptionSpec[];
	examples?: TreeseedCommandExample[];
	help?: TreeseedCommandHelpSpec;
	notes?: string[];
	helpVisible?: boolean;
	helpFeatured?: boolean;
	executionMode: TreeseedExecutionMode;
	handlerName?: string;
	delegateTo?: TreeseedExecutionDelegate;
	buildAdapterInput?: TreeseedAdapterInputBuilder;
};

export type TreeseedCommandSpec = TreeseedOperationSpec;

export type TreeseedOperationRequest = {
	commandName: string;
	argv?: string[];
};

export type TreeseedOperationResult = TreeseedCommandResult & {
	operation?: TreeseedOperationId;
	ok?: boolean;
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

export type TreeseedSdkOperationResult = SdkOperationResult;
