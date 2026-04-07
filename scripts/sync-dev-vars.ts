import { applyTreeseedEnvironmentToProcess, writeTreeseedLocalEnvironmentFiles } from './config-runtime-lib.ts';

const tenantRoot = process.cwd();
applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local' });
const result = writeTreeseedLocalEnvironmentFiles(tenantRoot);
console.log(`Wrote ${result.envLocalPath}`);
console.log(`Wrote ${result.devVarsPath}`);
