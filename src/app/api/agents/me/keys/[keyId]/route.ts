import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { ensureAgentRecord } from '@/lib/agents/store';
import { writeAgentActivity } from '@/lib/agents/audit';

type RouteContext = { params: Promise<{ keyId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent credential storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  const { keyId } = await context.params;
  if (!/^[A-Za-z0-9_-]{16}$/.test(keyId)) {
    return apiError(404, 'AGENT_KEY_NOT_FOUND', 'Agent credential was not found.');
  }
  const firestore = adminFirestore;
  const keyRef = firestore.collection('agentApiKeys').doc(keyId);
  const sessionRef = firestore.collection('agentSessions').doc(keyId);
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before managing credentials.');
    }
    const result = await firestore.runTransaction(async (transaction) => {
      const [keySnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(keyRef),
        transaction.get(sessionRef),
      ]);
      const key = keySnapshot.data();
      if (
        !keySnapshot.exists
        || !key
        || key.ownerId !== ownerId
        || key.agentId !== agent.agentId
      ) {
        return false;
      }
      if (key.status !== 'revoked') {
        const now = getServerTimestamp();
        transaction.update(keyRef, { status: 'revoked', revokedAt: now });
        if (sessionSnapshot.exists) {
          transaction.update(sessionRef, { status: 'revoked', revokedAt: now });
        }
        writeAgentActivity(firestore, transaction, {
          ownerId,
          agentId: agent.agentId,
          actorId: ownerId,
          action: 'agent.api_key.revoked',
          details: { keyId },
        });
      }
      return true;
    });
    return result
      ? apiSuccess({ keyId, status: 'revoked' })
      : apiError(404, 'AGENT_KEY_NOT_FOUND', 'Agent credential was not found.');
  } catch (error: unknown) {
    console.error('Failed to revoke agent credential.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent credential could not be revoked.');
  }
}
