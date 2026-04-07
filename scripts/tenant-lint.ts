import { packageScriptPath, runNodeScript } from './package-tools.ts';

runNodeScript(packageScriptPath('cleanup-markdown'), ['--check'], {
	cwd: process.cwd(),
});
