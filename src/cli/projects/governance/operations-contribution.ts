import type { OperationSpec } from '../../operations/operations-types.ts';

export const contributionOperationSpecs:OperationSpec[]=[{
	id:'project.contribution-authorization',name:'contribution',aliases:[],group:'Utilities',summary:'Manage human-owned project contribution authorization and diagnose delegated agent eligibility.',
	description:'Plans, applies, reads, revokes, projects, and diagnoses standing project contribution authorization without permitting agents to grant legal authority.',provider:'default',related:['governance','capacity'],
	usage:'trsd contribution <plan|apply|show|revoke|project|diagnose> --project <project-id> [--file <yaml>] [--market local] [--yes] [--json]',arguments:[{name:'action',description:'Contribution authorization action.',required:true}],
	options:[
		{name:'market',flags:'--market <id-or-url>',description:'Configured market id or local API URL.',kind:'string'},
		{name:'project',flags:'--project <project-id>',description:'TreeSeed project identifier.',kind:'string'},
		{name:'authorization',flags:'--authorization <authorization-id>',description:'Standing authorization to revoke.',kind:'string'},
		{name:'file',flags:'--file <path>',description:'YAML or JSON scope/plan document.',kind:'string'},
		{name:'document',flags:'--document <yaml-or-json>',description:'Inline YAML or JSON scope/plan document.',kind:'string'},
		{name:'output',flags:'--output <path>',description:'Safe public project policy output path.',kind:'string'},
		{name:'agent',flags:'--agent <agent-id>',description:'Agent identity to diagnose.',kind:'string'},
		{name:'provider',flags:'--provider <capacity-provider-id>',description:'Capacity provider identity to diagnose.',kind:'string'},
		{name:'branch',flags:'--branch <target-branch>',description:'Target branch to diagnose.',kind:'string'},
		{name:'yes',flags:'--yes',description:'Confirm apply, revoke, or policy projection after inspecting plan.',kind:'boolean'},
		{name:'json',flags:'--json',description:'Emit machine-readable JSON.',kind:'boolean'},
	],examples:['trsd contribution plan --market local --project project_123 --file contribution-scope.yaml --json','trsd contribution apply --market local --project project_123 --file reviewed-plan.yaml --yes --json','trsd contribution diagnose --market local --project project_123 --agent agent:engineer --provider provider_123 --branch staging --json'],
	help:{longSummary:['A human team owner grants once at project scope; agents only consume exact scoped receipts.'],whenToUse:['Use before activating agent-authored staging PRs.'],beforeYouRun:['Plan first and inspect the exact grant text, identities, repository, branches, expiry, and digest.'],automationNotes:['Agents may run show and diagnose. Apply, revoke, and project require human authority and --yes.']},helpVisible:true,helpFeatured:false,executionMode:'handler',handlerName:'contribution',
}];
