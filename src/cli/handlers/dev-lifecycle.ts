export type TreeseedDevProcessAction = 'start' | 'restart';

export function resolveTreeseedDevProcessAction(input: {
	subcommand: string;
	reset: boolean;
}): TreeseedDevProcessAction {
	return input.subcommand === 'restart' || input.reset ? 'restart' : 'start';
}
