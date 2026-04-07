import { packageScriptPath, runNodeScript } from './package-tools.ts';

runNodeScript(packageScriptPath('tenant-check'), [], {
	cwd: process.cwd(),
});
