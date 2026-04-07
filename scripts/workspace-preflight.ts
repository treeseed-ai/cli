#!/usr/bin/env node

import { resolve } from 'node:path';
import { collectCliPreflight, formatCliPreflightReport, writeJsonArtifact } from './workspace-preflight-lib.ts';

const args = new Set(process.argv.slice(2));
const requireAuth = args.has('--require-auth');
const json = args.has('--json');
const reportPathArgIndex = process.argv.indexOf('--report-path');
const reportPath = reportPathArgIndex >= 0 ? process.argv[reportPathArgIndex + 1] : process.env.TREESEED_PREFLIGHT_REPORT_PATH;

const report = collectCliPreflight({
	cwd: process.cwd(),
	requireAuth,
});

if (reportPath) {
	writeJsonArtifact(resolve(reportPath), report);
}

if (json) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(formatCliPreflightReport(report));
}

process.exit(report.ok ? 0 : 1);
