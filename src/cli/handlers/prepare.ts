import type { TreeseedCommandHandler } from '../types.js';
import { handleConfig } from './config.js';

export const handlePrepare: TreeseedCommandHandler = (invocation, context) => handleConfig({
	...invocation,
	commandName: invocation.commandName || 'prepare',
}, context);
