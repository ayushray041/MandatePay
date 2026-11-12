import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { timestampToIso } from '@/lib/mandates/format';
import {
  canViewMarketplaceDirectory,
  ensureMarketplaceViewer,
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
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace review storage is unavailable.');
  }
  const { agentId } = await context.params;
  if (!/^agt_[A-Za-z0-9_-]{32}$/.test(agentId)) {
    return apiError(404, 'AGENT_NOT_FOUND', 'Marketplace agent was not found.');
  }
  try {
    const firestore = adminFirestore;
    const [identitySnapshot, profileSnapshot, viewer] = await Promise.all([
      firestore.collection('agentIdentities').doc(agentId).get(),
      firestore.collection('agentMarketplaceProfiles').doc(agentId).get(),
      ensureMarketplaceViewer(firestore, authentication.user.uid),
    ]);
    const identity = identitySnapshot.data();
    const profile = profileSnapshot.data();
    const ownerUid = identity?.agentUid;
    const settings = parseMarketplaceDirectorySettings(profile?.directorySettings);
    if (
      !identitySnapshot.exists
      || !profileSnapshot.exists
      || !identity
      || !profile
      || identity.agentId !== agentId
      || profile.agentId !== agentId
      || profile.ownerId !== ownerUid
      || typeof ownerUid !== 'string'
      || !settings
      || !canViewMarketplaceDirectory(settings, ownerUid, viewer)
    ) {
      return apiError(404, 'AGENT_NOT_FOUND', 'Marketplace agent was not found.');
    }
    if (!await marketplaceOwnerHasDirectoryAccess(firestore, settings, ownerUid)) {
      return apiError(404, 'AGENT_NOT_FOUND', 'Marketplace agent was not found.');
    }
    const agent = await firestore.collection('agents').doc(ownerUid).get();
    if (
      !agent.exists
      || agent.data()?.status !== 'active'
      || agent.data()?.agentId !== agentId
      || agent.data()?.ownerId !== ownerUid
    ) {
      return apiError(404, 'AGENT_NOT_FOUND', 'Marketplace agent was not found.');
    }
    const reviews = await firestore.collection('marketplaceReviews')
      .where('agentId', '==', agentId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return apiSuccess(reviews.docs.map((review) => ({
      id: review.id,
      agentId,
      rating: review.data().rating,
      comment: review.data().comment,
      reviewerLabel: 'Verified customer',
      createdAt: timestampToIso(review.data().createdAt),
    })));
  } catch (error: unknown) {
    console.error('Failed to load marketplace reviews.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Marketplace reviews could not be loaded.');
  }
}
