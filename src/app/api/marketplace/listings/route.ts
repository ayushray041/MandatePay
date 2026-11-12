import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { ensureAgentRecord } from '@/lib/agents/store';
import { writeAgentActivity } from '@/lib/agents/audit';
import {
  ensureMarketplaceAgentProfile,
  ensureMarketplaceViewer,
  formatMarketplaceListing,
  parseMarketplaceDirectorySettings,
  searchMarketplaceListings,
} from '@/lib/marketplace/store';
import {
  marketplaceListingSearchSchema,
  marketplaceServiceListingInputSchema,
} from '@/models/marketplace';

function searchParamsRecord(url: URL): Record<string, string> | null {
  const record: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of url.searchParams.entries()) {
    if (Object.hasOwn(record, key)) {
      return null;
    }
    record[key] = value;
  }
  return record;
}

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace storage is unavailable.');
  }
  const params = searchParamsRecord(new URL(request.url));
  if (!params) {
    return apiError(400, 'INVALID_ARGUMENT', 'Search filters must not contain duplicate parameters.');
  }
  const parsed = marketplaceListingSearchSchema.safeParse(params);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Marketplace search filters are invalid.');
  }

  try {
    const viewer = await ensureMarketplaceViewer(adminFirestore, authentication.user.uid);
    return apiSuccess(await searchMarketplaceListings(adminFirestore, viewer, parsed.data));
  } catch (error: unknown) {
    console.error('Marketplace search failed.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Marketplace listings could not be loaded.');
  }
}

export async function POST(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Service listing must be valid JSON.');
  }
  const parsed = marketplaceServiceListingInputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Service listing details are invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace storage is unavailable.');
  }

  const firestore = adminFirestore;
  const ownerUid = authentication.user.uid;
  try {
    const agent = await ensureAgentRecord(ownerUid);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before publishing a service.');
    }
    if (agent.status !== 'active') {
      return apiError(403, 'AGENT_SUSPENDED', 'Suspended agents cannot publish services.');
    }
    const marketplaceProfile = await ensureMarketplaceAgentProfile(firestore, ownerUid, agent.agentId);
    const settings = parseMarketplaceDirectorySettings(marketplaceProfile.directorySettings);
    if (!settings) {
      throw new Error('Stored marketplace directory settings are invalid.');
    }
    const listingRef = firestore.collection('agentServiceListings').doc();
    const versionRef = listingRef.collection('versions').doc('000001');
    const profileRef = firestore.collection('agentMarketplaceProfiles').doc(agent.agentId);
    const agentRef = firestore.collection('agents').doc(ownerUid);
    const organizationRef = settings.visibility === 'organization'
      ? firestore.collection('marketplaceOrganizations').doc(settings.organizationId)
      : null;
    const memberRef = organizationRef?.collection('members').doc(ownerUid) ?? null;
    const ownListingsQuery = firestore.collection('agentServiceListings')
      .where('ownerUid', '==', ownerUid)
      .limit(50);
    const created = await firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, agentSnapshot, ownListings] = await Promise.all([
        transaction.get(profileRef),
        transaction.get(agentRef),
        transaction.get(ownListingsQuery),
      ]);
      const organizationSnapshots = organizationRef && memberRef
        ? await Promise.all([
          transaction.get(organizationRef),
          transaction.get(memberRef),
        ])
        : null;
      const storedProfile = profileSnapshot.data();
      const storedAgent = agentSnapshot.data();
      if (
        !profileSnapshot.exists
        || storedProfile?.ownerId !== ownerUid
        || storedProfile.agentId !== agent.agentId
        || !agentSnapshot.exists
        || storedAgent?.agentId !== agent.agentId
        || storedAgent.status !== 'active'
      ) {
        return { error: 'agent_changed' as const };
      }
      const currentSettings = parseMarketplaceDirectorySettings(storedProfile.directorySettings);
      if (
        !currentSettings
        || JSON.stringify(currentSettings) !== JSON.stringify(settings)
      ) {
        return { error: 'settings_changed' as const };
      }
      if (ownListings.size >= 50) {
        return { error: 'listing_limit' as const };
      }
      if (organizationSnapshots) {
        if (!organizationSnapshots[0].exists || !organizationSnapshots[1].exists) {
          return { error: 'organization_membership_required' as const };
        }
      }
      const now = getServerTimestamp();
      const listing = {
        ...parsed.data,
        agentId: agent.agentId,
        ownerUid,
        visibility: currentSettings.visibility,
        organizationId: currentSettings.visibility === 'organization'
          ? currentSettings.organizationId
          : null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      transaction.create(listingRef, listing);
      transaction.create(versionRef, {
        version: 1,
        createdBy: ownerUid,
        createdAt: now,
        snapshot: listing,
      });
      writeAgentActivity(firestore, transaction, {
        ownerId: ownerUid,
        agentId: agent.agentId,
        actorId: ownerUid,
        action: 'marketplace.service.created',
        details: { listingId: listingRef.id, status: listing.status },
      });
      return { listing };
    });
    if ('error' in created) {
      if (created.error === 'listing_limit') {
        return apiError(409, 'LISTING_LIMIT_REACHED', 'An agent can maintain at most 50 service listings.');
      }
      if (created.error === 'organization_membership_required') {
        return apiError(403, 'ORGANIZATION_MEMBERSHIP_REQUIRED', 'Join the organization before publishing this service.');
      }
      return apiError(409, 'MARKETPLACE_PROFILE_CHANGED', 'Marketplace settings changed; reload and retry.');
    }
    return apiSuccess({
      listing: formatMarketplaceListing(
        listingRef.id,
        created.listing,
        { ...agent },
        'unverified',
        null,
      ),
      status: created.listing.status,
    }, 201);
  } catch (error: unknown) {
    console.error('Failed to create marketplace service listing.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Service listing could not be created.');
  }
}
