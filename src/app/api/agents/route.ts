import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { timestampToIso } from '@/lib/mandates/format';
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

  try {
    let query = adminFirestore.collection('agents').orderBy('updatedAt', 'desc').limit(50);
    if (category) {
      query = adminFirestore.collection('agents')
        .where('categories', 'array-contains', category)
        .orderBy('updatedAt', 'desc')
        .limit(50);
    }
    const snapshot = await query.get();
    return apiSuccess(snapshot.docs
      .filter((agent) => agent.id !== authentication.user.uid)
      .map((agent) => {
        const data = agent.data();
        return {
          uid: agent.id,
          ...(typeof data.agentId === 'string' ? { agentId: data.agentId } : {}),
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
  } catch (error: unknown) {
    console.error('Failed to discover agents.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agents could not be loaded.');
  }
}
