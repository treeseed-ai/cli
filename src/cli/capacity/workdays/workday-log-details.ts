import type { DetailRow, WorkdayLogViewRecord } from './workday-log-types.js';
import { isRecord, valueAt, stringValue, formatDuration, agentRecord, assignmentRecord, timingRecord, executionProviderRecord, modeRunRecords, addWrapped, addSection, addField, compactDurationForRecord, selectedInputRecord, cycleLabel, subjectLabel, artifactKindLabel, tokenUsage, recordFromPath, recordsFrom, collectWorkPackages, selectPrimaryWorkPackage, codexRunRecord, contextRecordFromWorkPackage, treeDxEvidenceRecords, renderValuePreview, compactScalar, readableList, addBullet, addFieldIfPresent, addCompactKV, addRecordFields } from './workday-log-model.js';

export function sourceForModeRun(modeRun: Record<string, unknown>) {
	const outputs = isRecord(valueAt(modeRun, 'outputs')) ? valueAt(modeRun, 'outputs') as Record<string, unknown> : {};
	const metadata = isRecord(valueAt(outputs, 'metadata')) ? valueAt(outputs, 'metadata') as Record<string, unknown> : {};
	return stringValue(valueAt(modeRun, 'source') ?? valueAt(metadata, 'source'), '');
}

export function metadataForModeRun(modeRun: Record<string, unknown>) {
	const outputs = isRecord(valueAt(modeRun, 'outputs')) ? valueAt(modeRun, 'outputs') as Record<string, unknown> : {};
	const metadata = isRecord(valueAt(outputs, 'metadata')) ? valueAt(outputs, 'metadata') as Record<string, unknown> : {};
	return {
		outputs,
		metadata,
	};
}

export function treeDxProxyModeRuns(record: WorkdayLogViewRecord) {
	return modeRunRecords(record).filter((modeRun) => sourceForModeRun(modeRun) === 'provider_runner_treedx_proxy_request');
}

export function proxyRequestLabel(metadata: Record<string, unknown>) {
	const preview = isRecord(valueAt(metadata, 'bodyPreview')) ? valueAt(metadata, 'bodyPreview') as Record<string, unknown> : {};
	const target = stringValue(valueAt(preview, 'path') ?? valueAt(preview, 'query') ?? readableList(valueAt(preview, 'paths')), '');
	const operation = stringValue(valueAt(metadata, 'operation'), 'request');
	return target ? `${operation} ${target}` : operation;
}

export function addTreeDxProxyCalls(rows: DetailRow[], record: WorkdayLogViewRecord, width: number) {
	const calls = treeDxProxyModeRuns(record);
	if (!calls.length) {
		rows.push({ text: 'No TreeDX proxy call telemetry was captured for this execution.', color: 'red' });
		return;
	}
	const byOperation = new Map<string, { started?: Record<string, unknown>; completed?: Record<string, unknown>; failed?: Record<string, unknown> }>();
	for (const call of calls) {
		const { metadata } = metadataForModeRun(call);
		const operation = stringValue(valueAt(metadata, 'operation'), 'request');
		const path = stringValue(valueAt(metadata, 'path'), '');
		const bodyPreview = valueAt(metadata, 'bodyPreview');
		const key = `${operation}:${path}:${JSON.stringify(bodyPreview ?? {})}`;
		const entry = byOperation.get(key) ?? {};
		const phase = stringValue(valueAt(metadata, 'phase'), '');
		if (phase === 'started') entry.started = call;
		if (phase === 'completed') entry.completed = call;
		if (phase === 'failed') entry.failed = call;
		byOperation.set(key, entry);
	}
	for (const [key, entry] of byOperation.entries()) {
		const chosen = entry.failed ?? entry.completed ?? entry.started;
		if (!chosen) continue;
		const { metadata } = metadataForModeRun(chosen);
		const phase = stringValue(valueAt(metadata, 'phase'), 'recorded');
		const tone: DetailRow['color'] = phase === 'failed' ? 'red' : phase === 'completed' ? 'green' : 'yellow';
		addWrapped(rows, `${phase.toUpperCase()} ${proxyRequestLabel(metadata)}`, width, { color: tone, bold: true });
		addWrapped(rows, `  endpoint=${stringValue(valueAt(metadata, 'path'))}`, width, { color: 'gray' });
		addWrapped(rows, `  duration=${formatDuration(valueAt(metadata, 'durationMs'))} http=${stringValue(valueAt(metadata, 'httpStatus'))} resultKeys=${readableList(valueAt(metadata, 'resultKeys'))}`, width, { color: 'gray' });
		const bodyPreview = valueAt(metadata, 'bodyPreview');
		if (isRecord(bodyPreview)) {
			for (const [requestKey, requestValue] of Object.entries(bodyPreview)) {
				if (requestValue !== undefined) addWrapped(rows, `  request.${requestKey}=${compactScalar(requestValue)}`, width, { color: 'gray' });
			}
		}
		if (valueAt(metadata, 'errorMessage')) addWrapped(rows, `  error=${stringValue(valueAt(metadata, 'errorMessage'))}`, width, { color: 'red' });
	}
}

export function addTreeDxEvidence(rows: DetailRow[], workPackage: Record<string, unknown>, width: number) {
	const evidence = treeDxEvidenceRecords(workPackage);
	if (!evidence.length) {
		rows.push({ text: 'No TreeDX evidence records were captured.', color: 'red' });
		return;
	}
	for (const [index, entry] of evidence.entries()) {
		addWrapped(rows, `evidence ${index + 1}: ${stringValue(valueAt(entry, 'id'), 'treedx-evidence')} (${stringValue(valueAt(entry, 'purpose'), 'context')})`, width, { color: 'cyan', bold: true });
		addRecordFields(rows, '  source ref', valueAt(entry, 'sourceRef'), width - 2, 'gray');
		const files = Array.isArray(valueAt(entry, 'files')) ? valueAt(entry, 'files') as unknown[] : [];
		for (const file of files.filter(isRecord)) {
			addWrapped(rows, `  file: ${stringValue(valueAt(file, 'path'))}`, width, { color: 'green' });
			addWrapped(rows, `    ${renderValuePreview(valueAt(file, 'text'), width - 4)}`, width, { color: 'white' });
		}
		const pack = valueAt(entry, 'pack');
		if (pack !== undefined) {
			addWrapped(rows, `  context pack: ${renderValuePreview(pack, width - 2)}`, width, { color: 'gray' });
		}
		const results = valueAt(entry, 'results') ?? valueAt(entry, 'response');
		if (results !== undefined) {
			addWrapped(rows, `  result: ${renderValuePreview(results, width - 2)}`, width, { color: 'gray' });
		}
		const queries = Array.isArray(valueAt(entry, 'queries')) ? valueAt(entry, 'queries') as unknown[] : [];
		for (const query of queries.filter(isRecord)) {
			addWrapped(rows, `  configured query: ${stringValue(valueAt(query, 'id'), 'query')} (${stringValue(valueAt(query, 'purpose'), 'context')})`, width, { color: 'magenta' });
			addWrapped(rows, `    ${stringValue(valueAt(query, 'query'), '')}`, width, { color: 'white' });
			addWrapped(rows, `    scopes=${renderValuePreview(valueAt(query, 'codeScopes'), width - 6)} budget=${stringValue(valueAt(query, 'budget'))} depth=${stringValue(valueAt(query, 'depth'))}`, width, { color: 'gray' });
		}
		const warnings = Array.isArray(valueAt(entry, 'warnings')) ? valueAt(entry, 'warnings') as unknown[] : [];
		for (const warning of warnings) addWrapped(rows, `  warning: ${String(warning)}`, width, { color: 'red' });
	}
}

export function contentArtifactRows(record: WorkdayLogViewRecord, width: number) {
	const rows: DetailRow[] = [];
	const artifacts = uniqueArtifactsForRecord(record);
	if (artifacts.length === 0) {
		rows.push({ text: 'No content artifacts recorded.', color: 'gray' });
		return rows;
	}
	for (const artifact of artifacts) {
		const path = stringValue(valueAt(artifact, 'contentPath') ?? valueAt(artifact, 'uri'), 'artifact?');
		addWrapped(rows, `${stringValue(valueAt(artifact, 'artifactKind'), 'artifact')} -> ${path}`, width, { color: 'green' });
		addWrapped(rows, `model=${stringValue(valueAt(artifact, 'model'))} subject=${stringValue(valueAt(artifact, 'subjectId'))} producedBy=${stringValue(valueAt(artifact, 'producedByAgent'))}`, width, { color: 'gray' });
	}
	return rows;
}

export function uniqueArtifactsForRecord(record: WorkdayLogViewRecord) {
	const artifacts = Array.isArray(valueAt(record, 'contentArtifactRefs')) ? valueAt(record, 'contentArtifactRefs') as unknown[] : [];
	const byKey = new Map<string, Record<string, unknown>>();
	for (const artifact of artifacts.filter(isRecord)) {
		const key = stringValue(valueAt(artifact, 'contentPath') ?? valueAt(artifact, 'uri') ?? valueAt(artifact, 'id'), JSON.stringify(artifact));
		byKey.set(key, artifact);
	}
	return [...byKey.values()];
}

export function providerMessageRows(record: WorkdayLogViewRecord) {
	return modeRunRecords(record).filter((modeRun) => sourceForModeRun(modeRun) === 'provider_runner_message');
}

export function executionLifecycleRows(record: WorkdayLogViewRecord) {
	return modeRunRecords(record).filter((modeRun) => {
		const source = sourceForModeRun(modeRun);
		return source === 'execution_provider_starting' || source === 'execution_provider_adapter_lifecycle';
	});
}

export function addAgentConfiguration(rows: DetailRow[], record: WorkdayLogViewRecord, width: number) {
	const starting = executionLifecycleRows(record).find((modeRun) => sourceForModeRun(modeRun) === 'execution_provider_starting');
	const { metadata } = starting ? metadataForModeRun(starting) : { metadata: {} };
	const agent = isRecord(valueAt(metadata, 'agent')) ? valueAt(metadata, 'agent') as Record<string, unknown> : {};
	const execution = isRecord(valueAt(agent, 'execution')) ? valueAt(agent, 'execution') as Record<string, unknown> : {};
	const handoff = valueAt(agent, 'handoff');
	if (Object.keys(agent).length === 0) {
		rows.push({ text: 'No execution-start agent configuration snapshot was captured.', color: 'yellow' });
		return;
	}
	addField(rows, 'agent slug', valueAt(agent, 'slug'), width, 'cyan');
	addField(rows, 'agent name', valueAt(agent, 'name'), width, 'white');
	addField(rows, 'handler', valueAt(agent, 'handler'), width, 'gray');
	addField(rows, 'context query count', valueAt(agent, 'contextQueryCount'), width, 'gray');
	addField(rows, 'execution provider', valueAt(execution, 'provider'), width, 'gray');
	addField(rows, 'execution model', valueAt(execution, 'model'), width, 'cyan');
	addField(rows, 'sandbox', valueAt(execution, 'sandboxMode'), width, 'gray');
	addField(rows, 'approval policy', valueAt(execution, 'approvalPolicy'), width, 'gray');
	addField(rows, 'allowed paths', readableList(valueAt(execution, 'allowedPaths')), width, 'green');
	addField(rows, 'forbidden paths', readableList(valueAt(execution, 'forbiddenPaths')), width, 'red');
	if (isRecord(handoff)) {
		addField(rows, 'handoff output model', valueAt(handoff, 'outputModel') ?? valueAt(handoff, 'model'), width, 'gray');
		addField(rows, 'handoff artifact kind', valueAt(handoff, 'artifactKind'), width, 'gray');
		addField(rows, 'handoff collection', valueAt(handoff, 'targetCollection') ?? valueAt(handoff, 'collection'), width, 'gray');
	}
}

export function addForensicOverview(rows: DetailRow[], input: {
	record: WorkdayLogViewRecord;
	workPackage: Record<string, unknown>;
	codex: Record<string, unknown>;
	codexUsage: Record<string, unknown>;
	codexRequest: Record<string, unknown>;
	width: number;
}) {
	const { record, workPackage, codex, codexUsage, codexRequest, width } = input;
	const agent = agentRecord(record);
	const assignment = assignmentRecord(record);
	const timing = timingRecord(record);
	const proxyCalls = treeDxProxyModeRuns(record);
	const proxyFailures = proxyCalls.filter((modeRun) => {
		const { metadata } = metadataForModeRun(modeRun);
		return valueAt(metadata, 'phase') === 'failed';
	});
	const evidence = treeDxEvidenceRecords(workPackage);
	const artifacts = uniqueArtifactsForRecord(record);
	const messages = providerMessageRows(record);
	const finalResponse = stringValue(valueAt(codex, 'finalResponse'), '');
	const responseStatus = finalResponse.startsWith('TASK_WAITING') ? 'TASK_WAITING' : finalResponse ? 'responded' : 'missing';
	addSection(rows, 'Agent Run Summary');
	addWrapped(rows, `${stringValue(valueAt(agent, 'agentId'), 'agent?')} on ${stringValue(valueAt(agent, 'projectSlug') ?? valueAt(agent, 'projectId'), 'project?')} (${stringValue(valueAt(record, 'mode'), 'mode?')})`, width, { color: 'cyan', bold: true });
	addCompactKV(rows, 'state', [
		['run', valueAt(record, 'status')],
		['assignment', valueAt(assignment, 'status')],
		['lease', valueAt(assignment, 'leaseState')],
		['runner', valueAt(assignment, 'runnerId')],
	], width);
	addCompactKV(rows, 'time', [
		['started', valueAt(timing, 'startedAt') ?? valueAt(timing, 'createdAt')],
		['finished', valueAt(timing, 'finishedAt') ?? valueAt(timing, 'completedAt') ?? valueAt(timing, 'failedAt')],
		['duration', formatDuration(valueAt(timing, 'durationMs'))],
		['modelWall', `${stringValue(valueAt(codexUsage, 'wallMs'))}ms`],
	], width);
	addCompactKV(rows, 'AI', [
		['provider', valueAt(codex, 'provider') ?? 'codex'],
		['model', valueAt(codexRequest, 'model')],
		['status', valueAt(codex, 'status')],
		['response', responseStatus],
		['promptChars', valueAt(codexRequest, 'promptCharacters')],
	], width);
	addCompactKV(rows, 'tokens', [
		['input', valueAt(codexUsage, 'inputTokens')],
		['output', valueAt(codexUsage, 'outputTokens')],
		['cached', valueAt(codexUsage, 'cachedInputTokens')],
		['filesChanged', valueAt(codexUsage, 'filesChanged')],
	], width);
	addCompactKV(rows, 'TreeDX', [
		['proxyCalls', proxyCalls.length],
		['proxyFailures', proxyFailures.length],
		['evidenceRecords', evidence.length],
		['artifacts', artifacts.length],
		['messages', messages.length],
	], width);
	if (proxyFailures.length) {
		for (const failed of proxyFailures.slice(0, 4)) {
			const { metadata } = metadataForModeRun(failed);
			addWrapped(rows, `TreeDX failure: ${stringValue(valueAt(metadata, 'operation'))} ${stringValue(valueAt(metadata, 'errorMessage'))}`, width, { color: 'red' });
		}
	}
	if (finalResponse) {
		addWrapped(rows, `AI response preview: ${truncateLine(finalResponse.replace(/\s+/gu, ' '), width - 2)}`, width, { color: responseStatus === 'TASK_WAITING' ? 'red' : 'white' });
	}
}

export function addCodexRawItems(rows: DetailRow[], codex: Record<string, unknown>, width: number) {
	const rawItems = recordsFrom(recordFromPath(codex, ['metadata']).rawItems);
	if (!rawItems.length) {
		rows.push({ text: 'No raw Codex SDK event items were captured for this execution.', color: 'yellow' });
		return;
	}
	for (const [index, item] of rawItems.entries()) {
		const label = stringValue(valueAt(item, 'type') ?? valueAt(item, 'kind'), 'event');
		addWrapped(rows, `${index + 1}. ${label} id=${stringValue(valueAt(item, 'id'))}`, width, { color: 'cyan', bold: true });
		for (const [key, value] of Object.entries(item)) {
			if (['id', 'type', 'kind'].includes(key)) continue;
			addWrapped(rows, `   ${key}: ${compactScalar(value)}`, width, { color: 'gray' });
		}
	}
}

export function addWorkPackageSummary(rows: DetailRow[], workPackage: Record<string, unknown>, width: number) {
	if (!Object.keys(workPackage).length) {
		rows.push({ text: 'No work package snapshot was captured.', color: 'red' });
		return;
	}
	addField(rows, 'kind', valueAt(workPackage, 'kind'), width, 'gray');
	addField(rows, 'title', valueAt(workPackage, 'title'), width, 'white');
	addField(rows, 'summary', valueAt(workPackage, 'summary'), width, 'gray');
	const expectedOutputs = recordsFrom(valueAt(workPackage, 'expectedOutputs'));
	if (expectedOutputs.length) {
		rows.push({ text: 'expected outputs', color: 'cyan', bold: true });
		for (const output of expectedOutputs) {
			addBullet(rows, `${stringValue(valueAt(output, 'type'))}: ${stringValue(valueAt(output, 'description'))}`, width, 'gray');
		}
	}
	const constraints = isRecord(valueAt(workPackage, 'constraints')) ? valueAt(workPackage, 'constraints') as Record<string, unknown> : {};
	if (Object.keys(constraints).length) {
		addField(rows, 'mode', valueAt(constraints, 'mode'), width, 'gray');
		addField(rows, 'allowed paths', readableList(valueAt(constraints, 'allowedPaths')), width, 'green');
		addField(rows, 'forbidden paths', readableList(valueAt(constraints, 'forbiddenPaths')), width, 'red');
	}
}

export function buildDetailRows(record: WorkdayLogViewRecord | null, width: number) {
	const rows: DetailRow[] = [];
	if (!record) {
		return [{ text: 'No execution selected.', color: 'gray' }];
	}
	const agent = agentRecord(record);
	const assignment = assignmentRecord(record);
	const timing = timingRecord(record);
	const provider = executionProviderRecord(record);
	const modeRuns = modeRunRecords(record);
	const codex = codexRunRecord(record);
	const codexMetadata = isRecord(valueAt(codex, 'metadata')) ? valueAt(codex, 'metadata') as Record<string, unknown> : {};
	const codexRequest = isRecord(valueAt(codexMetadata, 'request')) ? valueAt(codexMetadata, 'request') as Record<string, unknown> : {};
	const usage = tokenUsage(record);
	const workPackages = collectWorkPackages(record);
	const primaryWorkPackage = selectPrimaryWorkPackage(workPackages);
	const workPackageContext = contextRecordFromWorkPackage(primaryWorkPackage);
	const contextDiagnostics = valueAt(workPackageContext, 'contextDiagnostics') ?? valueAt(primaryWorkPackage, 'contextDiagnostics');
	const treeDxHandle = isRecord(contextDiagnostics) ? recordFromPath(contextDiagnostics, ['treeDxProxyHandle']) : {};
	const artifacts = uniqueArtifactsForRecord(record);
	const messages = providerMessageRows(record);
	const proxyCalls = treeDxProxyModeRuns(record);
	const proxyFailures = proxyCalls.filter((modeRun) => valueAt(metadataForModeRun(modeRun).metadata, 'phase') === 'failed');
	const evidence = treeDxEvidenceRecords(primaryWorkPackage);
	const finalResponse = stringValue(valueAt(codex, 'finalResponse'), '');
	const objective = valueAt(selectedInputRecord(record), 'objective');

	addSection(rows, 'Run');
	addWrapped(rows, `${stringValue(valueAt(agent, 'agentId'), 'agent?')} / ${stringValue(valueAt(record, 'mode'), 'mode?')} / ${cycleLabel(record)}`, width, { color: 'cyan', bold: true });
	addCompactKV(rows, 'state', [
		['execution', valueAt(record, 'status')],
		['assignment', valueAt(assignment, 'status')],
		['lease', valueAt(assignment, 'leaseState')],
		['runner', valueAt(assignment, 'runnerId')],
	], width);
	addCompactKV(rows, 'time', [
		['started', valueAt(timing, 'startedAt') ?? valueAt(timing, 'createdAt')],
		['finished', valueAt(timing, 'finishedAt') ?? valueAt(timing, 'completedAt') ?? valueAt(timing, 'failedAt')],
		['duration', compactDurationForRecord(record)],
	], width);
	addCompactKV(rows, 'work', [
		['project', valueAt(agent, 'projectSlug') ?? valueAt(agent, 'projectId')],
		['class', valueAt(agent, 'projectAgentClassId') ?? valueAt(agent, 'classSlug')],
		['handler', valueAt(agent, 'handlerId')],
		['artifact', artifactKindLabel(record)],
		['subject', subjectLabel(record)],
	], width);
	if (objective) addWrapped(rows, `objective: ${stringValue(objective)}`, width, { color: 'white' });

	addSection(rows, 'AI');
	addCompactKV(rows, 'model', [
		['provider', valueAt(codex, 'provider') ?? valueAt(provider, 'id') ?? 'codex'],
		['model', valueAt(codexRequest, 'model')],
		['reasoning', valueAt(codexRequest, 'reasoningEffort')],
		['sandbox', valueAt(codexRequest, 'sandboxMode')],
		['approval', valueAt(codexRequest, 'approvalPolicy')],
	], width);
	addCompactKV(rows, 'usage', [
		['inputTokens', usage.input],
		['outputTokens', usage.output],
		['cachedTokens', usage.cached],
		['wall', formatDuration(usage.wallMs)],
		['promptChars', valueAt(codexRequest, 'promptCharacters')],
	], width);
	if (!Object.keys(codex).length) rows.push({ text: 'No AI model snapshot was captured for this execution.', color: 'red' });
	if (finalResponse) addWrapped(rows, `response: ${truncateLine(finalResponse.replace(/\s+/gu, ' '), width - 2)}`, width, { color: finalResponse.startsWith('TASK_WAITING') ? 'red' : 'white' });

	addSection(rows, 'Context');
	const coreObjective = recordFromPath(workPackageContext, ['coreObjective']);
	addCompactKV(rows, 'TreeDX', [
		['available', isRecord(contextDiagnostics) ? valueAt(contextDiagnostics, 'treeDxAvailable') : null],
		['coreObjective', isRecord(contextDiagnostics) ? valueAt(contextDiagnostics, 'coreObjectiveIncluded') : Boolean(Object.keys(coreObjective).length)],
		['evidence', evidence.length],
		['proxyCalls', proxyCalls.length],
		['proxyFailures', proxyFailures.length],
	], width);
	addFieldIfPresent(rows, 'core objective', valueAt(coreObjective, 'path') ?? (String(JSON.stringify(workPackageContext)).includes('src/content/objectives/core.md') ? 'src/content/objectives/core.md' : null), width, 'green');
	if (Object.keys(treeDxHandle).length) {
		addField(rows, 'read paths', readableList(valueAt(treeDxHandle, 'allowedReadPaths') ?? valueAt(treeDxHandle, 'allowedPaths')), width, 'green');
		addField(rows, 'write paths', readableList(valueAt(treeDxHandle, 'allowedWritePaths') ?? valueAt(treeDxHandle, 'allowedPaths')), width, 'yellow');
	}
	for (const modeRun of proxyCalls.slice(-8)) {
		const metadata = metadataForModeRun(modeRun).metadata;
		if (valueAt(metadata, 'phase') !== 'completed' && valueAt(metadata, 'phase') !== 'failed') continue;
		addWrapped(rows, `${stringValue(valueAt(metadata, 'operation'))}: ${stringValue(valueAt(metadata, 'httpStatus'))} in ${formatDuration(valueAt(metadata, 'durationMs'))}`, width, { color: valueAt(metadata, 'phase') === 'failed' ? 'red' : 'gray' });
	}

	addSection(rows, 'Artifacts');
	if (!artifacts.length) {
		rows.push({ text: 'No content artifacts recorded.', color: 'gray' });
	} else {
		for (const artifact of artifacts) {
			addWrapped(rows, `${stringValue(valueAt(artifact, 'artifactKind'), 'artifact')} -> ${stringValue(valueAt(artifact, 'contentPath') ?? valueAt(artifact, 'uri'))}`, width, { color: 'green' });
		}
	}

	addSection(rows, 'Messages');
	if (!messages.length) {
		rows.push({ text: 'No messages or signals recorded.', color: 'gray' });
	} else {
		for (const message of messages.slice(0, 10)) {
			const outputs = isRecord(valueAt(message, 'outputs')) ? valueAt(message, 'outputs') as Record<string, unknown> : {};
			const metadata = isRecord(valueAt(outputs, 'metadata')) ? valueAt(outputs, 'metadata') as Record<string, unknown> : {};
			const providerMessage = isRecord(valueAt(metadata, 'message')) ? valueAt(metadata, 'message') as Record<string, unknown> : {};
			addWrapped(rows, `${stringValue(valueAt(providerMessage, 'type') ?? valueAt(outputs, 'summary'), 'message')} ${stringValue(valueAt(providerMessage, 'status'), '')}`, width, { color: 'white' });
		}
	}

	addSection(rows, 'Timeline');
	addField(rows, 'telemetry events', modeRuns.length, width, 'gray');
	for (const modeRun of modeRuns.filter((entry) => {
		const source = sourceForModeRun(entry);
		return source.startsWith('provider_runner_') || source.startsWith('execution_provider_') || source.startsWith('agent_kernel_');
	}).slice(0, 18)) {
		const outputs = isRecord(valueAt(modeRun, 'outputs')) ? valueAt(modeRun, 'outputs') as Record<string, unknown> : {};
		addWrapped(rows, `${stringValue(valueAt(modeRun, 'createdAt') ?? valueAt(modeRun, 'startedAt'), 'time?')} ${stringValue(sourceForModeRun(modeRun), 'event')}: ${stringValue(valueAt(outputs, 'summary'), '').replace(/\s+/gu, ' ').slice(0, 140)}`, width, { color: 'gray' });
	}
	return rows.length > 0 ? rows : [{ text: '(empty)', color: 'gray' }];
}

