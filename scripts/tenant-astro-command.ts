import { resolveAstroBin, runNodeBinary } from './package-tools.ts';

const args = process.argv.slice(2);

runNodeBinary(resolveAstroBin(), args, { cwd: process.cwd() });
