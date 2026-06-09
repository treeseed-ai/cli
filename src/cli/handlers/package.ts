import type { TreeseedCommandHandler } from '../types.js';
import { runPackageImageCommand } from './package-image.js';
import { fail } from './utils.js';

export const handlePackage: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'status';
	try {
		if (action === 'image') return runPackageImageCommand(invocation, context, { commandName: 'package image' });
		return fail('Unknown package action. Use image.');
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
};

