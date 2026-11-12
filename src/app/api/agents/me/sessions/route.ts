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
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent session storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before viewing sessions.');
    }
    const sessions = await adminFirestore.collection('agentSessions')
      .where('ownerId', '==', ownerId)
      .where('agentId', '==', agent.agentId)
      .orderBy('lastSeenAt', 'desc')
      .limit(50)
      .get();
    return apiSuccess(sessions.docs.map((snapshot) => {
      const session = snapshot.data();
      return {
        sessionId: snapshot.id,
        keyId: session.keyId,
        status: session.status,
        createdAt: timestampToIso(session.createdAt),
        lastSeenAt: timestampToIso(session.lastSeenAt),
        expiresAt: timestampToIso(session.expiresAt),
      };
    }));
  } catch (error: unknown) {
    console.error('Failed to load agent sessions.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent sessions could not be loaded.');
  }
}
