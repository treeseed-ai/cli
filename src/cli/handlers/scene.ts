import type { TreeseedCommandHandler } from '../types.ts';
import { handleSceneExecution } from './scene-execution.js';
import { handleScenePublication } from './scene-publication.js';

export const handleScene: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'status';
	const executionResult = await handleSceneExecution(action, invocation, context);
	if (executionResult) return executionResult;
	const publicationResult = await handleScenePublication(action, invocation, context);
	if (publicationResult) return publicationResult;
	const message = `Unsupported scene action "${action}". Phase 11 supports status, validate, plan, run, inspect, resume, render, training, evidence, publish, publish-plan, export, and visual-audit.`;
	return {
		exitCode: 1,
		stdout: [],
		stderr: [message],
		report: {
			command: 'scene',
			ok: false,
			phase: 11,
			error: message,
			supportedActions: ['status', 'validate', 'plan', 'run', 'inspect', 'resume', 'render', 'training', 'evidence', 'publish', 'publish-plan', 'export', 'visual-audit'],
		},
	};
};
