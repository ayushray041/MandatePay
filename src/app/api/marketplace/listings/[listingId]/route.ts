import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { ensureAgentRecord } from '@/lib/agents/store';
import { writeAgentActivity } from '@/lib/agents/audit';
import {
  canViewMarketplaceListing,
  ensureMarketplaceAgentProfile,
  ensureMarketplaceViewer,
  formatMarketplaceListing,
  marketplaceOwnerHasDirectoryAccess,
  parseMarketplaceDirectorySettings,
} from '@/lib/marketplace/store';
import { marketplaceServiceListingInputSchema } from '@/models/marketplace';

type RouteContext = { params: Promise<{ listingId: string }> };

async function loadVisibleListing(listingId: string, viewerUid: string) {
  if (!adminFirestore) {
    return { error: apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace storage is unavailable.') };
  }
  const listingRef = adminFirestore.collection('agentServiceListings').doc(listingId);
  const listingSnapshot = await listingRef.get();
  const listing = listingSnapshot.data();
  if (!listingSnapshot.exists || !listing || typeof listing.ownerUid !== 'string') {
    return { error: apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.') };
  }
  const [agentSnapshot, marketplaceProfileSnapshot, metricsSnapshot, viewer] = await Promise.all([
    adminFirestore.collection('agents').doc(listing.ownerUid).get(),
    adminFirestore.collection('agentMarketplaceProfiles').doc(String(listing.agentId)).get(),
    adminFirestore.collection('marketplaceAgentMetrics').doc(String(listing.agentId)).get(),
    ensureMarketplaceViewer(adminFirestore, viewerUid),
  ]);
  const agent = agentSnapshot.data();
  const marketplaceProfile = marketplaceProfileSnapshot.data();
  const settings = parseMarketplaceDirectorySettings(marketplaceProfile?.directorySettings);
  const isOwner = listing.ownerUid === viewerUid;
  const ownerHasDirectoryAccess = settings
    ? await marketplaceOwnerHasDirectoryAccess(adminFirestore, settings, listing.ownerUid)
    : false;
  if (
    !agentSnapshot.exists
    || !agent
    || agent.status !== 'active'
    || agent.agentId !== listing.agentId
    || agent.ownerId !== listing.ownerUid
    || !marketplaceProfileSnapshot.exists
    || !marketplaceProfile
    || marketplaceProfile.agentId !== listing.agentId
    || marketplaceProfile.ownerId !== listing.ownerUid
    || !settings
    || !ownerHasDirectoryAccess
    || !canViewMarketplaceListing(listing, settings, listing.ownerUid, viewer)
    || (!isOwner && listing.status !== 'published')
  ) {
    return { error: apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.') };
  }
  return {
    listing,
    listingRef,
    agent,
    marketplaceProfile,
    metrics: metricsSnapshot.data(),
    isOwner,
    settings,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  const { listingId } = await context.params;
  if (!listingId || listingId.includes('/')) {
    return apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.');
  }
  try {
    const result = await loadVisibleListing(listingId, authentication.user.uid);
    if ('error' in result) {
      return result.error;
    }
    const formatted = formatMarketplaceListing(
      listingId,
      result.listing,
      result.agent,
      result.marketplaceProfile.verificationStatus === 'verified' ? 'verified' : 'unverified',
      result.metrics,
    );
    return apiSuccess(result.isOwner
      ? {
        listing: formatted,
        status: result.listing.status,
        visibility: result.listing.visibility,
        organizationId: result.listing.organizationId ?? null,
      }
      : { listing: formatted });
  } catch (error: unknown) {
    console.error('Failed to load marketplace service listing.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Service listing could not be loaded.');
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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
  const { listingId } = await context.params;
  if (!listingId || listingId.includes('/')) {
    return apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.');
  }

  const firestore = adminFirestore;
  const ownerUid = authentication.user.uid;
  try {
    const agent = await ensureAgentRecord(ownerUid);
    if (!agent || agent.status !== 'active') {
      return apiError(403, 'AGENT_REQUIRED', 'An active registered agent is required to manage services.');
    }
    const profile = await ensureMarketplaceAgentProfile(firestore, ownerUid, agent.agentId);
    const settings = parseMarketplaceDirectorySettings(profile.directorySettings);
    if (!settings) {
      throw new Error('Stored marketplace directory settings are invalid.');
    }
    const listingRef = firestore.collection('agentServiceListings').doc(listingId);
    const profileRef = firestore.collection('agentMarketplaceProfiles').doc(agent.agentId);
    const agentRef = firestore.collection('agents').doc(ownerUid);
    const organizationRef = settings.visibility === 'organization'
      ? firestore.collection('marketplaceOrganizations').doc(settings.organizationId)
      : null;
    const memberRef = organizationRef?.collection('members').doc(ownerUid) ?? null;
    const result = await firestore.runTransaction(async (transaction) => {
      const [listingSnapshot, marketplaceProfileSnapshot, agentSnapshot] = await Promise.all([
        transaction.get(listingRef),
        transaction.get(profileRef),
        transaction.get(agentRef),
      ]);
      const organizationSnapshots = organizationRef && memberRef
        ? await Promise.all([
          transaction.get(organizationRef),
          transaction.get(memberRef),
        ])
        : null;
      const current = listingSnapshot.data();
      const currentProfile = marketplaceProfileSnapshot.data();
      if (
        !listingSnapshot.exists
        || !current
        || current.ownerUid !== ownerUid
        || current.agentId !== agent.agentId
      ) {
        return { error: 'not_found' as const };
      }
      if (
        !marketplaceProfileSnapshot.exists
        || currentProfile?.ownerId !== ownerUid
        || currentProfile.agentId !== agent.agentId
        || !agentSnapshot.exists
        || agentSnapshot.data()?.status !== 'active'
      ) {
        return { error: 'not_active' as const };
      }
      const storedSettings = parseMarketplaceDirectorySettings(currentProfile.directorySettings);
      if (!storedSettings || JSON.stringify(storedSettings) !== JSON.stringify(settings)) {
        return { error: 'settings_changed' as const };
      }
      if (
        organizationSnapshots
        && (!organizationSnapshots[0].exists || !organizationSnapshots[1].exists)
      ) {
        return { error: 'organization_membership_required' as const };
      }
      const version = Number(current.version);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error('Stored service listing version is invalid.');
      }
      const nextVersion = version + 1;
      const now = getServerTimestamp();
      const updatedListing = {
        ...parsed.data,
        agentId: agent.agentId,
        ownerUid,
        visibility: settings.visibility,
        organizationId: settings.visibility === 'organization' ? settings.organizationId : null,
        version: nextVersion,
        createdAt: current.createdAt,
        updatedAt: now,
      };
      transaction.create(listingRef.collection('versions').doc(String(nextVersion).padStart(6, '0')), {
        version: nextVersion,
        createdBy: ownerUid,
        createdAt: now,
        snapshot: updatedListing,
      });
      transaction.update(listingRef, updatedListing);
      writeAgentActivity(firestore, transaction, {
        ownerId: ownerUid,
        agentId: agent.agentId,
        actorId: ownerUid,
        action: 'marketplace.service.updated',
        details: { listingId, status: updatedListing.status },
      });
      return { listing: updatedListing };
    });
    if ('error' in result) {
      if (result.error === 'not_found') {
        return apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.');
      }
      if (result.error === 'organization_membership_required') {
        return apiError(403, 'ORGANIZATION_MEMBERSHIP_REQUIRED', 'Join the organization before publishing this service.');
      }
      return apiError(409, 'MARKETPLACE_PROFILE_CHANGED', 'Marketplace settings changed; reload and retry.');
    }
    return apiSuccess({
      listing: formatMarketplaceListing(
        listingId,
        result.listing,
        { ...agent },
        profile.verificationStatus === 'verified' ? 'verified' : 'unverified',
        null,
      ),
      status: result.listing.status,
    });
  } catch (error: unknown) {
    console.error('Failed to update marketplace service listing.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Service listing could not be updated.');
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace storage is unavailable.');
  }
  const { listingId } = await context.params;
  if (!listingId || listingId.includes('/')) {
    return apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.');
  }
  const ownerUid = authentication.user.uid;
  const firestore = adminFirestore;
  const listingRef = firestore.collection('agentServiceListings').doc(listingId);
  try {
    const agent = await ensureAgentRecord(ownerUid);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Agent profile was not found.');
    }
    const archived = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(listingRef);
      const listing = snapshot.data();
      if (
        !snapshot.exists
        || !listing
        || listing.ownerUid !== ownerUid
        || listing.agentId !== agent.agentId
      ) {
        return false;
      }
      const version = Number(listing.version);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error('Stored service listing version is invalid.');
      }
      const nextVersion = version + 1;
      const now = getServerTimestamp();
      const updatedListing = {
        ...listing,
        status: 'paused',
        version: nextVersion,
        updatedAt: now,
      };
      transaction.create(listingRef.collection('versions').doc(String(nextVersion).padStart(6, '0')), {
        version: nextVersion,
        createdBy: ownerUid,
        createdAt: now,
        snapshot: updatedListing,
      });
      transaction.update(listingRef, { status: 'paused', version: nextVersion, updatedAt: now });
      writeAgentActivity(firestore, transaction, {
        ownerId: ownerUid,
        agentId: agent.agentId,
        actorId: ownerUid,
        action: 'marketplace.service.paused',
        details: { listingId },
      });
      return true;
    });
    return archived
      ? apiSuccess({ listingId, status: 'paused' })
      : apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.');
  } catch (error: unknown) {
    console.error('Failed to pause marketplace service listing.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Service listing could not be paused.');
  }
}
