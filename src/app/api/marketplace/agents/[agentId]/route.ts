import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { timestampToIso } from '@/lib/mandates/format';
import {
  canViewMarketplaceDirectory,
  canViewMarketplaceListing,
  ensureMarketplaceViewer,
  formatMarketplaceListing,
  marketplaceOwnerHasDirectoryAccess,
  parseMarketplaceDirectorySettings,
} from '@/lib/marketplace/store';

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace storage is unavailable.');
  }
  const { agentId } = await context.params;
  if (!/^agt_[A-Za-z0-9_-]{32}$/.test(agentId)) {
    return apiError(404, 'AGENT_NOT_FOUND', 'Marketplace agent was not found.');
  }

  const firestore = adminFirestore;
  try {
    const identitySnapshot = await firestore.collection('agentIdentities').doc(agentId).get();
    const identity = identitySnapshot.data();
    const marketplaceProfileSnapshot = await firestore.collection('agentMarketplaceProfiles').doc(agentId).get();
    const marketplaceProfile = marketplaceProfileSnapshot.data();
    const ownerUid = identity?.agentUid;
    if (
      !identitySnapshot.exists
      || !marketplaceProfileSnapshot.exists
      || !identity
      || !marketplaceProfile
      || identity.agentId !== agentId
      || marketplaceProfile.agentId !== agentId
      || marketplaceProfile.ownerId !== ownerUid
      || typeof ownerUid !== 'string'
    ) {
      return apiError(404, 'AGENT_NOT_FOUND', 'Marketplace agent was not found.');
    }
    const [agentSnapshot, metricsSnapshot, viewer] = await Promise.all([
      firestore.collection('agents').doc(ownerUid).get(),
      firestore.collection('marketplaceAgentMetrics').doc(agentId).get(),
      ensureMarketplaceViewer(firestore, authentication.user.uid),
    ]);
    const agent = agentSnapshot.data();
    const settings = parseMarketplaceDirectorySettings(marketplaceProfile.directorySettings);
    const ownerHasDirectoryAccess = settings
      ? await marketplaceOwnerHasDirectoryAccess(firestore, settings, ownerUid)
      : false;
    if (
      !agentSnapshot.exists
      || !agent
      || agent.agentId !== agentId
      || agent.ownerId !== ownerUid
      || agent.status !== 'active'
      || !settings
      || !ownerHasDirectoryAccess
      || !canViewMarketplaceDirectory(settings, ownerUid, viewer)
    ) {
      return apiError(404, 'AGENT_NOT_FOUND', 'Marketplace agent was not found.');
    }

    const listingsSnapshot = await firestore.collection('agentServiceListings')
      .where('agentId', '==', agentId)
      .where('status', '==', 'published')
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();
    const metrics = metricsSnapshot.data();
    const listings = listingsSnapshot.docs
      .filter((document) => canViewMarketplaceListing(document.data(), settings, ownerUid, viewer))
      .map((document) => formatMarketplaceListing(
        document.id,
        document.data(),
        agent,
        marketplaceProfile.verificationStatus === 'verified' ? 'verified' : 'unverified',
        metrics,
      ));
    const reviewsSnapshot = await firestore.collection('marketplaceReviews')
      .where('agentId', '==', agentId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    const profile = {
      agentId,
      displayName: agent.displayName,
      headline: agent.headline,
      bio: agent.bio,
      categories: agent.categories,
      capabilities: agent.capabilities,
      supportedCurrencies: agent.supportedCurrencies,
      availability: agent.availability,
      verificationStatus: marketplaceProfile.verificationStatus === 'verified' ? 'verified' : 'unverified',
      ...metricsSummary(metrics),
      createdAt: timestampToIso(agent.createdAt),
    };
    return apiSuccess({
      profile,
      listings,
      reviews: reviewsSnapshot.docs.map((review) => ({
        id: review.id,
        agentId,
        rating: review.data().rating,
        comment: review.data().comment,
        reviewerLabel: 'Verified customer',
        createdAt: timestampToIso(review.data().createdAt),
      })),
    });
  } catch (error: unknown) {
    console.error('Failed to load marketplace agent profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Marketplace agent profile could not be loaded.');
  }
}

function metricsSummary(value: unknown) {
  const metrics = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const count = (field: string) => (
    typeof metrics[field] === 'number' && Number.isSafeInteger(metrics[field]) && metrics[field] >= 0
      ? metrics[field]
      : 0
  );
  const reviewCount = count('reviewCount');
  const ratingTotal = count('ratingTotal');
  const successfulCaptureAttempts = count('successfulCaptureAttempts');
  const failedCaptureAttempts = count('failedCaptureAttempts');
  const attemptCount = successfulCaptureAttempts + failedCaptureAttempts;
  return {
    averageRating: reviewCount > 0 ? Math.round((ratingTotal / reviewCount) * 10) / 10 : 0,
    reviewCount,
    completedTransactions: count('completedTransactions'),
    successfulCaptureAttempts,
    failedCaptureAttempts,
    reliabilityPercent: attemptCount > 0
      ? Math.round((successfulCaptureAttempts / attemptCount) * 1000) / 10
      : null,
  };
}
