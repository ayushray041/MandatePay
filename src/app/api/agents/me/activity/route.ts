import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { ensureAgentRecord } from '@/lib/agents/store';
import { timestampToIso } from '@/lib/mandates/format';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent activity storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before viewing its activity.');
    }
    const events = await adminFirestore.collection('agentActivity')
      .where('ownerId', '==', ownerId)
      .where('agentId', '==', agent.agentId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return apiSuccess(events.docs.map((snapshot) => {
      const event = snapshot.data();
      return {
        id: snapshot.id,
        action: event.action,
        actorId: event.actorId,
        outcome: event.outcome ?? null,
        scope: event.scope ?? null,
        method: event.method ?? null,
        path: event.path ?? null,
        details: event.details ?? {},
        createdAt: timestampToIso(event.createdAt),
      };
    }));
  } catch (error: unknown) {
    console.error('Failed to load agent activity.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent activity could not be loaded.');
  }
}
