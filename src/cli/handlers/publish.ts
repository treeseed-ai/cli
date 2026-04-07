import type { TreeseedCommandHandler } from '../types.js';
import { handleDeploy } from './deploy.js';

export const handlePublish: TreeseedCommandHandler = (invocation, context) => handleDeploy({
	...invocation,
	commandName: invocation.commandName || 'publish',
}, context);
