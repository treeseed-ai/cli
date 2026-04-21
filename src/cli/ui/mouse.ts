import React from 'react';
import { useStdin, useStdout } from 'ink';

export type TerminalMouseEvent = {
	x: number;
	y: number;
	button: 'left' | 'middle' | 'right' | 'scroll-up' | 'scroll-down' | 'unknown';
	action: 'press' | 'release' | 'drag';
	shift: boolean;
	meta: boolean;
	ctrl: boolean;
};

function decodeButton(code: number): TerminalMouseEvent['button'] {
	if ((code & 64) === 64) {
		return (code & 1) === 1 ? 'scroll-down' : 'scroll-up';
	}
	switch (code & 3) {
		case 0:
			return 'left';
		case 1:
			return 'middle';
		case 2:
			return 'right';
		default:
			return 'unknown';
	}
}

function decodeAction(code: number, suffix: string): TerminalMouseEvent['action'] {
	if ((code & 32) === 32) {
		return 'drag';
	}
	return suffix === 'm' ? 'release' : 'press';
}

export function parseTerminalMouseInput(input: string): TerminalMouseEvent[] {
	const matches = input.matchAll(/\u001B\[<(\d+);(\d+);(\d+)([mM])/gu);
	const events: TerminalMouseEvent[] = [];
	for (const match of matches) {
		const code = Number(match[1] ?? 0);
		const x = Math.max(0, Number(match[2] ?? 0) - 1);
		const y = Math.max(0, Number(match[3] ?? 0) - 1);
		const suffix = match[4] ?? 'M';
		events.push({
			x,
			y,
			button: decodeButton(code),
			action: decodeAction(code, suffix),
			shift: (code & 4) === 4,
			meta: (code & 8) === 8,
			ctrl: (code & 16) === 16,
		});
	}
	return events;
}

export function useTerminalMouse(onEvent: (event: TerminalMouseEvent) => void, options: { enabled?: boolean } = {}) {
	const { stdin } = useStdin();
	const { stdout } = useStdout();
	const handlerRef = React.useRef(onEvent);

	React.useEffect(() => {
		handlerRef.current = onEvent;
	}, [onEvent]);

	React.useEffect(() => {
		if (options.enabled === false || !stdin || !stdout || !process.stdin.isTTY || !process.stdout.isTTY) {
			return;
		}

		stdout.write('\u001B[?1000h\u001B[?1006h');

		const handleData = (chunk: string | Buffer) => {
			const raw = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
			for (const event of parseTerminalMouseInput(raw)) {
				handlerRef.current(event);
			}
		};

		stdin.on('data', handleData);

		return () => {
			stdin.off('data', handleData);
			stdout.write('\u001B[?1000l\u001B[?1006l');
		};
	}, [options.enabled, stdin, stdout]);
}
