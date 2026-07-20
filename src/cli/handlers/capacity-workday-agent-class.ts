export function capacityWorkdayAgentClassId(projectId: string, configuredClassId: string): string {
	const project = projectId.trim();
	const agentClass = configuredClassId.trim();
	if (!project || !agentClass) throw new Error('Project id and configured agent-class id are required.');
	const prefix = `${project}:`;
	return agentClass.startsWith(prefix) ? agentClass : `${prefix}${agentClass}`;
}
