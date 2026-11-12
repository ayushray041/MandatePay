import { adminFirestore } from '@/lib/firebase/admin';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { authenticateAgentRequest } from '@/lib/agents/auth';
import { formatMandate } from '@/lib/mandates/format';

export async function GET(request: Request) {
  const authentication = await authenticateAgentRequest(request, 'mandates:read');
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  try {
    const snapshot = await adminFirestore.collection('mandates')
      .where('authorizedAgentId', '==', authentication.agent.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return apiSuccess(snapshot.docs
      .filter((mandate) => mandate.data().authorizedAgentId === authentication.agent.uid)
      .map((mandate) => formatMandate(mandate.id, mandate.data())));
  } catch (error: unknown) {
    console.error('Agent could not list authorized mandates.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Authorized mandates could not be loaded.');
  }
}
