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
import { agentCategorySchema } from '@/models/agent';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent storage is unavailable.');
  }

  const category = new URL(request.url).searchParams.get('category');
  if (category && !agentCategorySchema.safeParse(category).success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Agent category is invalid.');
  }

  const firestore = adminFirestore;
  try {
    let query = firestore.collection('agents').orderBy('updatedAt', 'desc').limit(50);
    if (category) {
      query = firestore.collection('agents')
        .where('categories', 'array-contains', category)
        .orderBy('updatedAt', 'desc')
        .limit(50);
    }
    const snapshot = await query.get();
    const viewer = await ensureMarketplaceViewer(firestore, authentication.user.uid);
    const profiles = await Promise.all(snapshot.docs
      .filter((agent) => agent.id !== authentication.user.uid)
      .map(async (agent) => {
        const data = agent.data();
        if (data.status !== 'active') {
          return null;
        }
        const agentId = typeof data.agentId === 'string' ? data.agentId : null;
        if (
          viewer.blocklistedAgentIds.has(agentId ?? '')
          || (viewer.allowlistedAgentIds.size > 0 && !viewer.allowlistedAgentIds.has(agentId ?? ''))
        ) {
          return null;
        }
        const [marketplaceProfileSnapshot, identitySnapshot] = agentId
          ? await Promise.all([
            firestore.collection('agentMarketplaceProfiles').doc(agentId).get(),
            firestore.collection('agentIdentities').doc(agentId).get(),
          ])
          : [null, null];
        const marketplaceProfile = marketplaceProfileSnapshot?.data();
        if (marketplaceProfileSnapshot?.exists) {
          const settings = parseMarketplaceDirectorySettings(marketplaceProfile?.directorySettings);
          const identity = identitySnapshot?.data();
          if (
            !marketplaceProfile
            || marketplaceProfile.agentId !== agentId
            || marketplaceProfile.ownerId !== agent.id
            || !identitySnapshot?.exists
            || !identity
            || identity.agentId !== agentId
            || identity.agentUid !== agent.id
            || !settings
            || !canViewMarketplaceDirectory(settings, agent.id, viewer)
            || !await marketplaceOwnerHasDirectoryAccess(firestore, settings, agent.id)
          ) {
            return null;
          }
        }
        return {
          uid: agent.id,
          ...(agentId ? { agentId } : {}),
          displayName: data.displayName,
          headline: data.headline,
          bio: data.bio,
          categories: data.categories,
          capabilities: data.capabilities,
          supportedCurrencies: data.supportedCurrencies,
          availability: data.availability,
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt),
        };
      }));
    return apiSuccess(profiles.filter((profile) => profile !== null));
  } catch (error: unknown) {
    console.error('Failed to discover agents.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agents could not be loaded.');
  }
}
