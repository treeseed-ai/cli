export type WorkdayLogFocusArea = 'planning' | 'acting' | 'detail';
export type WorkdayLogSection = 'planning' | 'acting';
export type DetailRow = {
	text: string;
	color?: 'cyan' | 'gray' | 'white' | 'yellow' | 'green' | 'magenta' | 'red' | 'blue' | 'black';
	bold?: boolean;
};
export type WorkdayLogViewRecord = Record<string, unknown>;
export type WorkdayLogUiInput = {
	title: string;
	subtitle: string;
	records: WorkdayLogViewRecord[];
	mouseEnabled?: boolean;
};
