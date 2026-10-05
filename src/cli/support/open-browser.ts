import { spawn } from 'node:child_process';

export interface BrowserLaunchCommand {
	command: string;
	arguments: string[];
}

export function browserLaunchCommand(url: string, platform = process.platform): BrowserLaunchCommand | null {
	const target = new URL(url);
	if (!['http:', 'https:'].includes(target.protocol)) return null;
	if (platform === 'darwin') return { command: 'open', arguments: [target.toString()] };
	if (platform === 'win32') return { command: 'rundll32.exe', arguments: ['url.dll,FileProtocolHandler', target.toString()] };
	if (platform === 'linux') return { command: 'xdg-open', arguments: [target.toString()] };
	return null;
}

export async function openBrowser(url: string) {
	const launch = browserLaunchCommand(url);
	if (!launch) return false;
	return new Promise<boolean>((resolve) => {
		const child = spawn(launch.command, launch.arguments, { detached: true, stdio: 'ignore', windowsHide: true });
		child.once('error', () => resolve(false));
		child.once('spawn', () => {
			child.unref();
			resolve(true);
		});
	});
}
