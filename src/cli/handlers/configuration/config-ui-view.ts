import { Box, Text } from 'ink';
import React from 'react';
import {
	AppFrame,
	EmptyState,
	PrimaryButton,
	ScrollPanel,
	SecondaryButton,
	SidebarList,
	StatusBar,
	TextInputField,
	truncateLine,
} from '../../ui/framework.js';
import type {
	ConfigContextSnapshot,
	ConfigEditorOptions,
	ConfigFocusArea,
	ConfigPage,
	ConfigScope,
	ConfigViewportLayout,
	ConfigViewMode,
	ConfigWizardStep,
} from './config-ui-types.js';
import { FULL_CONFIG_FILTERS } from './config-ui-model.js';
import { buttonRects, detailViewportLines } from './config-ui-layout.js';

type ConfigReadiness = Record<'github' | 'cloudflare' | 'railway' | 'localDevelopment', { configured: boolean }>;
type ConfigEditorViewInput = {
	actionIndex: number;
	actionRects: ReturnType<typeof buttonRects>;
	configReadiness: ConfigReadiness;
	currentContext: ConfigContextSnapshot;
	cursorPosition: number;
	detailPanel: ReturnType<typeof detailViewportLines>;
	draftValue: string;
	filterCursor: number;
	filterQuery: string;
	focusArea: ConfigFocusArea;
	layout: ConfigViewportLayout;
	options: ConfigEditorOptions;
	pages: ConfigPage[];
	safePageIndex: number;
	safeSidebarOffset: number;
	selectedFilter: ConfigScope;
	selectedPage: ConfigPage | null;
	sidebarFilterHeight: number;
	sidebarHeight: number;
	sidebarViewportSize: number;
	startupStep: ConfigWizardStep | null;
	statusMessage: string;
	viewMode: ConfigViewMode;
	visibleSidebar: ConfigPage[];
};

export function renderConfigEditorView(input: ConfigEditorViewInput) {
	const {
		actionIndex, actionRects, configReadiness, currentContext, cursorPosition, detailPanel,
		draftValue, filterCursor, filterQuery, focusArea, layout, options, pages,
		safePageIndex, safeSidebarOffset, selectedFilter, selectedPage, sidebarFilterHeight,
		sidebarHeight, sidebarViewportSize, startupStep, statusMessage, viewMode, visibleSidebar,
	} = input;

const titleLine = truncateLine(
	`Treeseed Config  ${currentContext.project.name} (${currentContext.project.slug})  GH cfg:${configReadiness.github.configured ? 'ok' : 'miss'}  CF cfg:${configReadiness.cloudflare.configured ? 'ok' : 'miss'}  RW cfg:${configReadiness.railway.configured ? 'ok' : 'miss'}`,
	layout.columns,
);
const statusTail = viewMode === 'full'
	? `Env ${selectedFilter}`
	: '';
const toolsLine = truncateLine(
	`gh:${options.toolAvailability?.githubCli?.available ? 'ok' : 'miss'}  wr:${options.toolAvailability?.wranglerCli?.available ? 'ok' : 'miss'}  rw:${options.toolAvailability?.railwayCli?.available ? 'ok' : 'miss'}  act:${options.toolAvailability?.ghActExtension?.available ? 'ok' : 'miss'}  dk:${options.toolAvailability?.dockerDaemon?.available ? 'ok' : 'miss'}  sec:${options.secretSession?.status?.unlocked ? 'on' : 'off'}${statusTail ? `  ${statusTail}` : ''}`,
	layout.columns,
);
const topBar = React.createElement(
	React.Fragment,
	null,
	React.createElement(Text, { color: 'cyan', bold: true }, titleLine),
	React.createElement(Text, { color: 'gray' }, toolsLine),
	viewMode === 'full'
		? React.createElement(Text, { color: focusArea === 'environment' ? 'cyan' : 'gray' }, truncateLine(`Env ${FULL_CONFIG_FILTERS.map((filter) => filter === selectedFilter ? `[${filter}]` : filter).join(' ')}`, layout.columns))
		: React.createElement(Text, { color: 'gray' }, truncateLine(`Wizard mode across ${currentContext.scopes.join(', ')}.`, layout.columns)),
);

const footer = React.createElement(StatusBar, {
	width: layout.columns,
	accent: focusArea === 'content',
	primary: viewMode === 'full'
		? `Tab cycles env, filter, list, editor, and actions. Type in Filter to narrow variables. Sidebar arrows${options.mouseEnabled === true ? ' or wheel' : ''} change selection.`
		: `Type or paste to edit. Left/Right move the cursor, Home/End jump, Enter updates and advances.`,
	secondary: statusMessage,
});

if (viewMode === 'startup') {
	const body = selectedPage
		? React.createElement(
			Box,
			{ flexDirection: 'column', width: layout.columns, height: layout.bodyHeight, overflow: 'hidden' },
			React.createElement(ScrollPanel, {
				width: layout.columns,
				height: layout.detailHeight,
				title: startupStep ? `Required Setup  ${Math.max(0, startupStep.total - startupStep.index - 1)} left` : 'Required Setup',
				lines: detailPanel.lines,
				focused: focusArea === 'content',
				tone: 'accent',
				scrollState: {
					offset: detailPanel.offset,
					viewportSize: detailPanel.viewportSize,
					totalSize: detailPanel.total,
				},
			}),
			React.createElement(TextInputField, {
				width: layout.columns,
				height: layout.inputHeight,
				label: 'Value',
				focused: focusArea === 'content',
				value: draftValue,
				cursorPosition,
				secret: selectedPage.entry.sensitivity === 'secret',
				placeholder: '',
				helperText: '',
			}),
			React.createElement(
				Box,
				{ width: layout.columns, height: layout.actionRowHeight },
				...actionRects.map((item, index) => React.createElement(
					item.label === 'Update + Next'
						? PrimaryButton
						: SecondaryButton,
					{
						key: item.label,
						label: item.label,
						focused: focusArea === 'actions' && index === actionIndex,
						width: item.rect.width,
					},
				)),
			),
		)
		: React.createElement(EmptyState, {
			width: layout.columns,
			height: layout.bodyHeight,
			title: 'Required Setup Complete',
			message: 'The required setup flow is complete.',
		});

	return React.createElement(AppFrame, { layout, topBar, body, footer });
}

const body = React.createElement(
	Box,
	{ width: layout.columns, height: layout.bodyHeight, overflow: 'hidden' },
	React.createElement(
		Box,
		{ flexDirection: 'column', width: layout.sidebarWidth, height: layout.bodyHeight, overflow: 'hidden' },
		React.createElement(TextInputField, {
			width: layout.sidebarWidth,
			height: sidebarFilterHeight,
			label: 'Filter',
			focused: focusArea === 'filter',
			value: filterQuery,
			cursorPosition: filterCursor,
			placeholder: 'id, label, group, cluster',
			helperText: 'Type to narrow by id, label, group, or cluster.',
		}),
		React.createElement(SidebarList, {
			width: layout.sidebarWidth,
			height: sidebarHeight,
			title: filterQuery ? `Variables (${pages.length})` : 'Variables',
			focused: focusArea === 'sidebar',
			scrollState: {
				offset: safeSidebarOffset,
				viewportSize: sidebarViewportSize,
				totalSize: pages.length,
			},
			items: visibleSidebar.map((page, index) => ({
				id: page.key,
				label: page.entry.id,
				active: safeSidebarOffset + index === safePageIndex,
				tone: page.required ? 'required' as const : 'normal' as const,
			})),
		}),
	),
	React.createElement(Text, null, ' '),
	React.createElement(
		Box,
		{ flexDirection: 'column', width: layout.contentWidth, height: layout.bodyHeight, overflow: 'hidden' },
		selectedPage
			? React.createElement(
				React.Fragment,
				null,
				React.createElement(ScrollPanel, {
					width: layout.contentWidth,
					height: layout.detailHeight,
					title: selectedPage.entry.label,
					lines: detailPanel.lines,
					focused: focusArea === 'content',
					tone: 'accent',
					scrollState: {
						offset: detailPanel.offset,
						viewportSize: detailPanel.viewportSize,
						totalSize: detailPanel.total,
					},
				}),
				React.createElement(TextInputField, {
					width: layout.contentWidth,
					height: layout.inputHeight,
					label: 'Value',
					focused: focusArea === 'content',
					value: draftValue,
					cursorPosition,
					secret: selectedPage.entry.sensitivity === 'secret',
					placeholder: '',
					helperText: '',
				}),
				React.createElement(
					Box,
					{ width: layout.contentWidth, height: layout.actionRowHeight },
					...actionRects.map((item, index) => React.createElement(
						item.label === 'Update + Next' ? PrimaryButton : SecondaryButton,
						{
							key: item.label,
							label: item.label,
							focused: focusArea === 'actions' && index === actionIndex,
							width: item.rect.width,
						},
					)),
				),
			)
			: React.createElement(EmptyState, {
				width: layout.contentWidth,
				height: layout.bodyHeight,
				title: 'No Matching Entries',
				message: 'No configuration variables match the current environment filter.',
			}),
	),
);

return React.createElement(AppFrame, { layout, topBar, body, footer });
}
