import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadAndPlanSeed, type SeedOperationRecipePlan } from '@treeseed/sdk/seeds';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';

function selectRecipe(recipes: SeedOperationRecipePlan[], recipeId: string) {
	return recipes.find((recipe) => recipe.id === recipeId && recipe.selected) ?? null;
}

function recipeStepLines(recipe: SeedOperationRecipePlan) {
	return recipe.orderedSteps.map((step, index) => {
		const dependencyText = step.dependsOn.length > 0 ? ` after ${step.dependsOn.join(', ')}` : '';
		return `${index + 1}. ${step.id} [${step.channel}:${step.operation}]${dependencyText}`;
	});
}

function stepScreenshots(recipe: SeedOperationRecipePlan) {
	return recipe.orderedSteps.flatMap((step) => (step.artifacts ?? [])
		.map((artifact: any) => typeof artifact?.screenshot === 'string' ? artifact.screenshot : null)
		.filter((entry): entry is string => Boolean(entry))
		.map((screenshot) => ({ stepId: step.id, screenshot })));
}

function preflightCliSteps(recipe: SeedOperationRecipePlan) {
	const preflight = new Set<string>();
	const delegated = new Set<string>();
	for (const step of recipe.orderedSteps) {
		if (step.channel !== 'cli') {
			continue;
		}
		const dependencies = Array.isArray(step.dependsOn) ? step.dependsOn : [];
		const ready = dependencies.every((dependency) => preflight.has(dependency));
		if (ready) {
			preflight.add(step.id);
		} else {
			delegated.add(step.id);
		}
	}
	return { preflight, delegated };
}

function executeCliRecipeStep(step: SeedOperationRecipePlan['orderedSteps'][number]) {
	const argv = Array.isArray((step as any).command?.argv) ? (step as any).command.argv.map(String) : [];
	if (argv.length === 0) {
		return {
			stepId: step.id,
			channel: step.channel,
			operation: step.operation,
			ok: false,
			exitCode: 1,
			error: 'CLI recipe step is missing command.argv.',
		};
	}
	const startedAt = new Date().toISOString();
	const started = Date.now();
	const command = argv[0] === 'trsd' || argv[0] === 'treeseed' ? 'npx' : argv[0];
	const args = argv[0] === 'trsd' || argv[0] === 'treeseed' ? ['trsd', ...argv.slice(1)] : argv.slice(1);
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		env: {
			TREESEED_DATABASE_URL: 'postgresql://treeseed:treeseed-local-dev@127.0.0.1:54329/treeseed_api',
			TREESEED_API_BASE_URL: 'http://127.0.0.1:3000',
			TREESEED_API_AUTH_SECRET: 'treeseed-api-dev-secret',
			TREESEED_API_WEB_SERVICE_ID: 'web',
			TREESEED_API_WEB_SERVICE_SECRET: 'treeseed-web-service-dev-secret',
			...process.env,
		},
		encoding: 'utf8',
	});
	return {
		stepId: step.id,
		channel: step.channel,
		operation: step.operation,
		ok: (result.status ?? 1) === 0,
		exitCode: result.status ?? 1,
		startedAt,
		finishedAt: new Date().toISOString(),
		durationMs: Date.now() - started,
		command: [command, ...args],
		stdout: result.stdout ? result.stdout.trim().split('\n').slice(-40) : [],
		stderr: result.stderr ? result.stderr.trim().split('\n').slice(-40) : [],
	};
}

export const handleDemo: TreeseedCommandHandler = async (invocation) => {
	const action = invocation.positionals[0] ?? 'generate';
	if (action !== 'generate') {
		return { exitCode: 1, stderr: [`Unknown demo action: ${action}`] };
	}
	const seedName = typeof invocation.args.seed === 'string' ? invocation.args.seed : 'treeseed';
	const recipeId = typeof invocation.args.recipe === 'string' ? invocation.args.recipe : 'full-private-team-demo';
	const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment : 'local';
	const baseUrl = typeof invocation.args.baseUrl === 'string'
		? invocation.args.baseUrl
		: process.env.TREESEED_DEMO_BASE_URL ?? 'http://127.0.0.1:4321';
	const artifactsDir = typeof invocation.args.artifactsDir === 'string'
		? invocation.args.artifactsDir
		: 'test-results/demo';
	const resolvedArtifactsDir = path.resolve(process.cwd(), artifactsDir);
	const execute = invocation.args.execute === true;
	const planned = loadAndPlanSeed({
		projectRoot: process.cwd(),
		seedName,
		environments: environment,
		mode: execute ? 'apply' : 'plan',
	});
	if (!planned.plan) {
		return {
			exitCode: 1,
			stderr: planned.diagnostics.map((diagnostic) => `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`),
			report: {
				command: 'demo',
				ok: false,
				seed: seedName,
				recipe: recipeId,
				environment,
				diagnostics: planned.diagnostics,
			},
		};
	}
	const recipe = selectRecipe(planned.plan.recipes, recipeId);
	if (!recipe) {
		return {
			exitCode: 1,
			stderr: [`Recipe ${recipeId} was not found for seed ${seedName} and environment ${environment}.`],
			report: {
				command: 'demo',
				ok: false,
				seed: seedName,
				recipe: recipeId,
				environment,
				availableRecipes: planned.plan.recipes.map((entry) => ({ id: entry.id, selected: entry.selected })),
			},
		};
	}
	const recipeJson = JSON.stringify(recipe);
	let run: Record<string, unknown> | null = null;
	let exitCode = 0;
	let stderr: string[] = [];
	if (execute) {
		mkdirSync(resolvedArtifactsDir, { recursive: true });
		const stepReports: Record<string, unknown>[] = [];
		const { preflight, delegated } = preflightCliSteps(recipe);
		for (const step of recipe.orderedSteps.filter((entry) => entry.channel === 'cli' && preflight.has(entry.id))) {
			const report = executeCliRecipeStep(step);
			stepReports.push(report);
			if (!report.ok) {
				exitCode = Number(report.exitCode ?? 1) || 1;
				stderr = Array.isArray(report.stderr) ? report.stderr.map(String) : [String(report.error ?? `${step.id} failed`)];
				const failedReport = {
					command: 'demo',
					ok: false,
					seed: seedName,
					recipe: recipeId,
					environment,
					baseUrl,
					artifactsDir,
					recipeSteps: recipe.orderedSteps,
					stepReports,
					run: null,
					completedAt: new Date().toISOString(),
				};
				writeFileSync(path.join(resolvedArtifactsDir, 'recipe-execution-report.json'), `${JSON.stringify(failedReport, null, 2)}\n`, 'utf8');
				break;
			}
		}
		for (const step of recipe.orderedSteps.filter((entry) => entry.channel === 'cli' && delegated.has(entry.id))) {
			stepReports.push({
				stepId: step.id,
				channel: step.channel,
				operation: step.operation,
				ok: true,
				delegated: 'playwright',
				reason: 'Step depends on UI-generated state and is executed by the Playwright workflow with captured runtime credentials.',
			});
		}
		if (exitCode !== 0) {
			run = { exitCode, stepReports };
		} else {
		const result = spawnSync('npm', ['run', 'test:demo:e2e', '--', '--output', path.join(resolvedArtifactsDir, 'playwright-output')], {
			cwd: process.cwd(),
			env: {
				...process.env,
				TREESEED_DEMO_BASE_URL: baseUrl,
				TREESEED_DEMO_ARTIFACTS_DIR: resolvedArtifactsDir,
				TREESEED_DEMO_SEED: seedName,
				TREESEED_DEMO_RECIPE: recipeId,
				TREESEED_DEMO_RECIPE_JSON: recipeJson,
			},
			encoding: 'utf8',
		});
		exitCode = result.status ?? 1;
		stderr = result.stderr ? result.stderr.trim().split('\n').filter(Boolean) : [];
		run = {
			exitCode,
			stdout: result.stdout ? result.stdout.trim().split('\n').slice(-40) : [],
			stderr,
			stepReports,
		};
		if (exitCode === 0) {
			const missingArtifacts = stepScreenshots(recipe)
				.map((entry) => ({ ...entry, path: path.join(resolvedArtifactsDir, 'screenshots', entry.screenshot) }))
				.filter((entry) => !existsSync(entry.path));
			if (missingArtifacts.length > 0) {
				exitCode = 1;
				stderr = missingArtifacts.map((entry) => `Missing recipe artifact for ${entry.stepId}: ${entry.path}`);
				run = {
					...run,
					exitCode,
					stderr,
					missingArtifacts,
				};
			}
		}
		const report = {
			command: 'demo',
			ok: exitCode === 0,
			seed: seedName,
			recipe: recipeId,
			environment,
			baseUrl,
			artifactsDir,
			recipeSteps: recipe.orderedSteps,
			stepReports,
			run,
			completedAt: new Date().toISOString(),
		};
		writeFileSync(path.join(resolvedArtifactsDir, 'recipe-execution-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
		}
	}
	return guidedResult({
		command: 'demo',
		summary: execute
			? (exitCode === 0 ? 'Demo workflow generated successfully.' : 'Demo workflow generation failed.')
			: 'Demo workflow generation recipe plan is ready.',
		facts: [
			{ label: 'Seed', value: seedName },
			{ label: 'Recipe', value: recipeId },
			{ label: 'Environment', value: environment },
			{ label: 'Base URL', value: baseUrl },
			{ label: 'Artifacts', value: artifactsDir },
			{ label: 'Execution', value: execute ? 'executed' : 'planned' },
		],
		sections: [{ title: 'Recipe DAG', lines: recipeStepLines(recipe) }],
		nextSteps: execute ? [] : [`Run \`trsd demo generate --seed ${seedName} --recipe ${recipeId} --environment ${environment} --execute --json\` after local dev is ready.`],
		report: {
			seed: seedName,
			recipe: recipeId,
			environment,
			baseUrl,
			artifactsDir,
			recipePlan: recipe,
			run,
		},
		exitCode,
		stderr,
	});
};
