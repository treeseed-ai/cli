export type DevProcessAction = 'start' | 'restart';

export function resolveDevProcessAction(input: {
	subcommand: string;
	reset: boolean;
}): DevProcessAction {
	return input.subcommand === 'restart' || input.reset ? 'restart' : 'start';
}
