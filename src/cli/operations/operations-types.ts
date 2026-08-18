import type {
	OperationContext as SdkOperationContext,
	OperationGroup,
	OperationId,
	OperationMetadata,
	OperationResult as SdkOperationResult,
} from '@treeseed/sdk/operations';

export type CommandGroup = OperationGroup;

export type ExecutionDelegate = 'agents';
export type ExecutionMode = 'handler' | 'adapter' | 'delegate';
export type ArgumentKind = 'positional' | 'message_tail';
export type OptionKind = 'boolean' | 'string' | 'enum';

export type CommandArgumentSpec = {
	name: string;
	description: string;
	required?: boolean;
	kind?: ArgumentKind;
};

export type CommandOptionSpec = {
	name: string;
	flags: string;
	description: string;
	kind: OptionKind;
	repeatable?: boolean;
	values?: string[];
};

export type StructuredCommandExample = {
	command: string;
	title: string;
	description: string;
	result?: string;
	why?: string;
};

export type CommandExample = string | StructuredCommandExample;

export type CommandHelpDetail = {
	name: string;
	detail: string;
};

export type CommandRelatedDetail = {
	name: string;
	why: string;
};

export type CommandHelpSpec = {
	workflowPosition?: string;
	longSummary?: string[];
	whenToUse?: string[];
	beforeYouRun?: string[];
	outcomes?: string[];
	examples?: StructuredCommandExample[];
	optionDetails?: CommandHelpDetail[];
	argumentDetails?: CommandHelpDetail[];
	automationNotes?: string[];
	warnings?: string[];
	relatedDetails?: CommandRelatedDetail[];
	seeAlso?: string[];
};

export type ParsedInvocation = {
	commandName: string;
	args: Record<string, string | string[] | boolean | undefined>;
	positionals: string[];
	rawArgs: string[];
};

export type CommandResult = {
	exitCode?: number;
	stdout?: string[];
	stderr?: string[];
	report?: Record<string, unknown> | null;
	suppressJsonResult?: boolean;
};

export type Writer = NonNullable<SdkOperationContext['write']>;
export type Spawner = NonNullable<SdkOperationContext['spawn']>;
export type PromptHandler = NonNullable<SdkOperationContext['prompt']>;
export type ConfirmHandler = NonNullable<SdkOperationContext['confirm']>;

export type CommandContext = {
	cwd: string;
	env: NodeJS.ProcessEnv;
	write: Writer;
	spawn: Spawner;
	outputFormat?: 'human' | 'json';
	interactiveUi?: boolean;
	colorEnabled?: boolean;
	prompt?: PromptHandler;
	confirm?: ConfirmHandler;
};

export type CommandHandler = (
	invocation: ParsedInvocation,
	context: CommandContext,
) => Promise<CommandResult> | CommandResult;

export type AdapterInputBuilder = (
	invocation: ParsedInvocation,
	context: CommandContext,
) => Record<string, unknown>;

export type OperationSpec = OperationMetadata & {
	usage?: string;
	arguments?: CommandArgumentSpec[];
	options?: CommandOptionSpec[];
	examples?: CommandExample[];
	help?: CommandHelpSpec;
	notes?: string[];
	helpVisible?: boolean;
	helpFeatured?: boolean;
	executionMode: ExecutionMode;
	handlerName?: string;
	delegateTo?: ExecutionDelegate;
	buildAdapterInput?: AdapterInputBuilder;
};

export type CommandSpec = OperationSpec;

export type OperationRequest = {
	commandName: string;
	argv?: string[];
};

export type OperationResult = CommandResult & {
	operation?: OperationId;
	ok?: boolean;
	payload?: Record<string, unknown> | null;
	meta?: Record<string, unknown>;
	nextSteps?: string[];
};

export type OperationExecutor = (
	spec: OperationSpec,
	argv: string[],
	context: CommandContext,
) => Promise<number> | number;

export type HandlerResolver = (handlerName: string) => CommandHandler | null;

export type SdkOperationResult = SdkOperationResult;
