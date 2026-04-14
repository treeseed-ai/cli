import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, workflowErrorResult } from './workflow.js';

export const handleExport: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const directory = typeof invocation.positionals[0] === 'string' && invocation.positionals[0].trim().length > 0
			? invocation.positionals[0]
			: undefined;
		const result = await createWorkflowSdk(context).export({ directory });
		const exported = result.payload as Record<string, any>;
		return guidedResult({
			command: 'export',
			summary: 'Treeseed export completed successfully.',
			facts: [
				{ label: 'Directory', value: exported.directory },
				{ label: 'Output', value: exported.outputPath },
				{ label: 'Branch', value: exported.branch },
				{ label: 'Timestamp', value: exported.timestamp },
				{ label: 'Files', value: exported.summary?.totalFiles },
				{ label: 'Tokens', value: exported.summary?.totalTokens },
				{ label: 'Bundled paths', value: Array.isArray(exported.includedBundlePaths) ? exported.includedBundlePaths.length : 0 },
			],
			report: exported,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
