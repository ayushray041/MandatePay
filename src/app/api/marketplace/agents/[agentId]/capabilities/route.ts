import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import {
  canViewMarketplaceDirectory,
  canViewMarketplaceListing,
  buildAgentCapabilityDocument,
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
    return apiError(404, 'AGENT_NOT_FOUND', 'Agent capability document was not found.');
  }

  const firestore = adminFirestore;
  try {
    const [identitySnapshot, marketplaceProfileSnapshot, viewer] = await Promise.all([
      firestore.collection('agentIdentities').doc(agentId).get(),
      firestore.collection('agentMarketplaceProfiles').doc(agentId).get(),
      ensureMarketplaceViewer(firestore, authentication.user.uid),
    ]);
    const identity = identitySnapshot.data();
    const marketplaceProfile = marketplaceProfileSnapshot.data();
    const ownerUid = identity?.agentUid;
    const settings = parseMarketplaceDirectorySettings(marketplaceProfile?.directorySettings);
    if (
      !identitySnapshot.exists
      || !marketplaceProfileSnapshot.exists
      || !identity
      || !marketplaceProfile
      || identity.agentId !== agentId
      || marketplaceProfile.agentId !== agentId
      || marketplaceProfile.ownerId !== ownerUid
      || typeof ownerUid !== 'string'
      || !settings
      || !await marketplaceOwnerHasDirectoryAccess(firestore, settings, ownerUid)
      || !canViewMarketplaceDirectory(settings, ownerUid, viewer)
    ) {
      return apiError(404, 'AGENT_NOT_FOUND', 'Agent capability document was not found.');
    }
    const [agentSnapshot, metricsSnapshot, listingsSnapshot] = await Promise.all([
      firestore.collection('agents').doc(ownerUid).get(),
      firestore.collection('marketplaceAgentMetrics').doc(agentId).get(),
      firestore.collection('agentServiceListings')
        .where('agentId', '==', agentId)
        .where('status', '==', 'published')
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get(),
    ]);
    const agent = agentSnapshot.data();
    if (!agentSnapshot.exists || !agent || agent.agentId !== agentId || agent.status !== 'active') {
      return apiError(404, 'AGENT_NOT_FOUND', 'Agent capability document was not found.');
    }
    const metrics = metricsSnapshot.data();
    const services = listingsSnapshot.docs
      .filter((document) => canViewMarketplaceListing(document.data(), settings, ownerUid, viewer))
      .map((document) => formatMarketplaceListing(
        document.id,
        document.data(),
        agent,
        marketplaceProfile.verificationStatus === 'verified' ? 'verified' : 'unverified',
        metrics,
      ));
    return apiSuccess(buildAgentCapabilityDocument(
      agentId,
      agent,
      services,
      Number(agent.version) + Number(marketplaceProfile.version),
      marketplaceProfile.updatedAt,
    ));
  } catch (error: unknown) {
    console.error('Failed to load agent capability document.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent capability document could not be loaded.');
  }
}
