export interface CapacityWorkdayProviderClient {
	capacityProviderMemberships(teamId: string): Promise<{ payload: unknown }>;
	providerAvailabilitySessions(teamId: string, filters?: { status?: string }): Promise<{ payload: unknown }>;
}

export interface CapacityWorkdayProviderResolution {
	providerId: string;
	providers: Array<Record<string, unknown>>;
}

function providerMatchesSelector(provider: Record<string, unknown>, selector: string) {
	const metadata = provider.metadata && typeof provider.metadata === 'object' ? provider.metadata as Record<string, unknown> : {};
	return [provider.id, provider.name, provider.provider, provider.kind, metadata.provider, metadata.localProviderId]
		.some((value) => String(value ?? '').toLowerCase() === selector.toLowerCase());
}

/** Resolve a CLI selector to a globally stable provider identity authorized by the team. */
export async function resolveCapacityWorkdayProviderId(
	client: CapacityWorkdayProviderClient,
	teamId: string,
	selector: string,
): Promise<CapacityWorkdayProviderResolution> {
	const membershipsResponse = await client.capacityProviderMemberships(teamId).catch(() => ({ payload: { items: [] } }));
	const providers = capacityCollectionItems(membershipsResponse.payload)
		.filter(isCapacityRecord)
		.filter((membership) => String(membership.status ?? '').toLowerCase() === 'approved')
		.map((membership) => ({
			...membership,
			id: membership.providerId,
			name: membership.teamAlias ?? membership.providerId,
		}));
	const matched = providers.find((provider) => providerMatchesSelector(provider, selector));
	if (matched?.id) return { providerId: String(matched.id), providers };

	if (selector.toLowerCase() === 'local') {
		const sessionsResponse = await client.providerAvailabilitySessions(teamId, { status: 'open' }).catch(() => ({ payload: { items: [] } }));
		const localProviderIds = [...new Set(capacityCollectionItems(sessionsResponse.payload)
			.filter(isCapacityRecord)
			.filter((session) => String(session.status ?? 'open').toLowerCase() === 'open')
			.filter((session) => String(session.environment ?? '').toLowerCase() === 'local')
			.map((session) => String(session.providerId ?? session.capacityProviderId ?? ''))
			.filter((providerId) => providers.some((provider) => String(provider.id) === providerId)))];
		if (localProviderIds.length === 1) return { providerId: localProviderIds[0]!, providers };
		if (localProviderIds.length > 1) {
			throw new Error(`Provider selector "local" is ambiguous across ${localProviderIds.length} approved providers. Pass an explicit provider id.`);
		}
		if (providers.length === 1) return { providerId: String(providers[0]!.id), providers };
	}

	throw new Error(`Capacity provider selector "${selector}" did not match an approved team membership.`);
}
import { capacityCollectionItems, isCapacityRecord } from '../../capacity-core/capacity-values.js';
