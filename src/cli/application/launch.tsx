import { controlPlaneOperation, encodeConfirmationState } from '@treeseed/sdk/operator-contracts';
import { ControlPlaneClientError, resolveControlPlaneServer, type ControlPlaneOperationCallOptions } from '@treeseed/sdk/control-plane-client';
import { render } from 'ink';
import React from 'react';
import type { SurfaceKind, WorkspaceId } from '@treeseed/ui/foundation';
import type { CommandContext } from '../types.js';
import { MouseProvider, WorkspaceApplication, enterWorkbench, leaveWorkbench } from './ui-runtime.js';
import { controlPlaneServerRegistry, createControlPlaneClient } from '../support/client.js';
import { loadServerSession } from '../support/server-custody.js';
import { createInkWorkspaceDataSource } from './data.js';

type Row = Record<string, unknown>;
type UiInvokeOptions = ControlPlaneOperationCallOptions & { uiConfirmed?: boolean };

function activeTeam(context: CommandContext, server?: string) {
	const registry = controlPlaneServerRegistry(context);
	const profile = resolveControlPlaneServer(server, registry);
	return { profile, teamId: loadServerSession(profile.serverId, context.env)?.activeTeam?.id };
}

export async function launchApplication(context: CommandContext, options: { server?: string; workspace?: WorkspaceId; surface?: SurfaceKind } = {}) {
	if (!context.interactiveUi || !process.stdin.isTTY || !process.stdout.isTTY) throw Object.assign(new Error('The integrated interface requires an interactive TTY.'), { category: 'invalid_input', code: 'interactive_tty_required' });
	const selected = activeTeam(context, options.server);
	if (!selected.teamId) throw Object.assign(new Error('Select an active team with `trsd teams use <team>` before opening the interface.'), { category: 'ambiguous_context', code: 'team_required' });
	let { client } = await createControlPlaneClient({ options: options.server ? { server: options.server } : {} }, context, true);
	const abort = new AbortController();
	const invoke = async (id: string, input: { path: Row; query: Row; body: unknown }, invokeOptions: UiInvokeOptions = {}) => {
		const { uiConfirmed = false, ...operationOptions } = invokeOptions;
		const requestOptions: ControlPlaneOperationCallOptions = { ...operationOptions, signal: abort.signal };
		const request = async () => {
			try { return await client.invoke(controlPlaneOperation(id), input, requestOptions); }
			catch (error) {
				if (Number((error as Row)?.status) !== 401) throw error;
				({ client } = await createControlPlaneClient({ options: options.server ? { server: options.server } : {} }, context, true, true));
				return client.invoke(controlPlaneOperation(id), input, requestOptions);
			}
		};
		let response: unknown;
		try { response = await request(); }
		catch (error) {
			const required = error instanceof ControlPlaneClientError ? error.problem.inputRequired : undefined;
			if (!required || !uiConfirmed) throw error;
			requestOptions.headers = { ...requestOptions.headers, 'x-treeseed-confirmation': encodeConfirmationState(required.confirmation) };
			response = await request();
		}
		if (id !== 'providers.connect') return response;
		const envelope = response && typeof response === 'object' && !Array.isArray(response) ? response as Row : {};
		const value = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) ? envelope.data as Row : envelope;
		const enrollmentToken = typeof value.enrollmentToken === 'string' ? value.enrollmentToken : '';
		if (!enrollmentToken || !context.providerEnrollmentHandoff) throw Object.assign(new Error('The control plane did not return a usable local provider enrollment handoff.'), { category: 'provider_unavailable', code: 'provider_enrollment_handoff_invalid' });
		const receipt = await context.providerEnrollmentHandoff({ action: 'begin', ...value, enrollmentToken,
			controlPlaneUrl: selected.profile.baseUrl, controlPlaneAudience: selected.profile.baseUrl, serverProfile: selected.profile.serverId });
		return { teamId: value.teamId, connectionState: 'approval_required', provider: receipt };
	};
	enterWorkbench(process.stdout);
	const dataSource = createInkWorkspaceDataSource(invoke, selected.teamId);
	const instance = render(<MouseProvider><WorkspaceApplication dataSource={dataSource} teamId={selected.teamId} initialWorkspace={options.workspace} initialSurface={options.surface} onDone={() => undefined}/></MouseProvider>, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, exitOnCtrlC: false, patchConsole: false });
	try { await instance.waitUntilExit(); return { interactiveSession: true, teamId: selected.teamId, workspace: options.workspace ?? 'team' }; }
	finally { abort.abort(); instance.unmount(); leaveWorkbench(process.stdout); }
}
