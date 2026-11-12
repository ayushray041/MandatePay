import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { ensureAgentRecord } from '@/lib/agents/store';
import { writeAgentActivity } from '@/lib/agents/audit';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent session storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  const { sessionId } = await context.params;
  if (!/^[A-Za-z0-9_-]{16}$/.test(sessionId)) {
    return apiError(404, 'AGENT_SESSION_NOT_FOUND', 'Agent session was not found.');
  }
  const firestore = adminFirestore;
  const sessionRef = firestore.collection('agentSessions').doc(sessionId);
  const keyRef = firestore.collection('agentApiKeys').doc(sessionId);
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before managing sessions.');
    }
    const revoked = await firestore.runTransaction(async (transaction) => {
      const [sessionSnapshot, keySnapshot] = await Promise.all([
        transaction.get(sessionRef),
        transaction.get(keyRef),
      ]);
      const session = sessionSnapshot.data();
      const key = keySnapshot.data();
      if (
        !sessionSnapshot.exists
        || !session
        || session.ownerId !== ownerId
        || session.agentId !== agent.agentId
        || !keySnapshot.exists
        || !key
        || key.ownerId !== ownerId
        || key.agentId !== agent.agentId
      ) {
        return false;
      }
      const now = getServerTimestamp();
      transaction.update(sessionRef, { status: 'revoked', revokedAt: now });
      transaction.update(keyRef, { status: 'revoked', revokedAt: now });
      writeAgentActivity(firestore, transaction, {
        ownerId,
        agentId: agent.agentId,
        actorId: ownerId,
        action: 'agent.session.revoked',
        details: { sessionId },
      });
      return true;
    });
    return revoked
      ? apiSuccess({ sessionId, status: 'revoked' })
      : apiError(404, 'AGENT_SESSION_NOT_FOUND', 'Agent session was not found.');
  } catch (error: unknown) {
    console.error('Failed to revoke agent session.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent session could not be revoked.');
  }
}
