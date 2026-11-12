import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { timestampToIso } from '@/lib/mandates/format';
import { aiDecisionHistoryEntrySchema } from '@/models/ai';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'AI history storage is unavailable.');
  }

  try {
    const snapshot = await adminFirestore.collection('aiDecisionHistory')
      .where('actorUserId', '==', authentication.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const entries = snapshot.docs.map((document) => {
      const data = { ...document.data() };
      delete data.actorUserId;
      return aiDecisionHistoryEntrySchema.parse({
        ...data,
        id: document.id,
        createdAt: timestampToIso(data.createdAt),
      });
    });
    return apiSuccess(entries);
  } catch (error: unknown) {
    console.error('Failed to load AI recommendation history.', error);
    return apiError(500, 'AI_HISTORY_UNAVAILABLE', 'AI recommendation history could not be loaded.');
  }
}
