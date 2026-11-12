import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { ensureAgentRecord } from '@/lib/agents/store';
import { ensureMarketplaceAgentProfile, formatMarketplaceListing } from '@/lib/marketplace/store';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace storage is unavailable.');
  }
  const ownerUid = authentication.user.uid;
  try {
    const agent = await ensureAgentRecord(ownerUid);
    if (!agent) {
      return apiSuccess([]);
    }
    const profile = await ensureMarketplaceAgentProfile(adminFirestore, ownerUid, agent.agentId);
    const [snapshot, metricsSnapshot] = await Promise.all([
      adminFirestore.collection('agentServiceListings')
        .where('ownerUid', '==', ownerUid)
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get(),
      adminFirestore.collection('marketplaceAgentMetrics').doc(agent.agentId).get(),
    ]);
    return apiSuccess(snapshot.docs
      .filter((document) => document.data().agentId === agent.agentId)
      .map((document) => ({
        listing: formatMarketplaceListing(
          document.id,
          document.data(),
          { ...agent },
          profile.verificationStatus === 'verified' ? 'verified' : 'unverified',
          metricsSnapshot.data(),
        ),
        status: document.data().status,
        visibility: document.data().visibility,
        organizationId: document.data().organizationId ?? null,
      })));
  } catch (error: unknown) {
    console.error('Failed to load owner service listings.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Service listings could not be loaded.');
  }
}
