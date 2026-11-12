import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { timestampToIso } from '@/lib/mandates/format';
import {
  canViewMarketplaceListing,
  ensureMarketplaceViewer,
  formatMarketplaceListing,
  marketplaceOwnerHasDirectoryAccess,
  parseMarketplaceDirectorySettings,
} from '@/lib/marketplace/store';

type RouteContext = { params: Promise<{ listingId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace history is unavailable.');
  }
  const { listingId } = await context.params;
  if (!listingId || listingId.includes('/')) {
    return apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.');
  }

  const firestore = adminFirestore;
  try {
    const listingRef = firestore.collection('agentServiceListings').doc(listingId);
    const listingSnapshot = await listingRef.get();
    const listing = listingSnapshot.data();
    if (!listingSnapshot.exists || !listing || typeof listing.ownerUid !== 'string') {
      return apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.');
    }
    const [agentSnapshot, marketplaceProfileSnapshot, metricsSnapshot, viewer] = await Promise.all([
      firestore.collection('agents').doc(listing.ownerUid).get(),
      firestore.collection('agentMarketplaceProfiles').doc(String(listing.agentId)).get(),
      firestore.collection('marketplaceAgentMetrics').doc(String(listing.agentId)).get(),
      ensureMarketplaceViewer(firestore, authentication.user.uid),
    ]);
    const agent = agentSnapshot.data();
    const marketplaceProfile = marketplaceProfileSnapshot.data();
    const settings = parseMarketplaceDirectorySettings(marketplaceProfile?.directorySettings);
    const isOwner = listing.ownerUid === authentication.user.uid;
    const ownerHasDirectoryAccess = settings
      ? await marketplaceOwnerHasDirectoryAccess(firestore, settings, listing.ownerUid)
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
      return apiError(404, 'LISTING_NOT_FOUND', 'Service listing was not found.');
    }

    const versions = await listingRef.collection('versions').orderBy('version', 'desc').limit(50).get();
    return apiSuccess(versions.docs.map((versionDocument) => {
      const version = versionDocument.data();
      const snapshot = version.snapshot;
      if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
        throw new Error('Stored service listing history is invalid.');
      }
      return {
        version: version.version,
        createdAt: timestampToIso(version.createdAt),
        listing: formatMarketplaceListing(
          listingId,
          snapshot as Record<string, unknown>,
          agent,
          marketplaceProfile.verificationStatus === 'verified' ? 'verified' : 'unverified',
          metricsSnapshot.data(),
        ),
      };
    }));
  } catch (error: unknown) {
    console.error('Failed to load marketplace listing history.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Service listing history could not be loaded.');
  }
}
