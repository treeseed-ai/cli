import type { TreeseedCommandHandler } from '../types.js';
import { handleRelease } from './release.js';

export const handlePromote: TreeseedCommandHandler = (invocation, context) => handleRelease({
	...invocation,
	commandName: invocation.commandName || 'promote',
}, context);
