import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { ensureAgentRecord } from '@/lib/agents/store';
import { writeAgentActivity } from '@/lib/agents/audit';

type RouteContext = { params: Promise<{ webhookId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent webhook storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  const { webhookId } = await context.params;
  const firestore = adminFirestore;
  const webhookRef = firestore.collection('agentWebhooks').doc(webhookId);
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before managing webhooks.');
    }
    const removed = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(webhookRef);
      const webhook = snapshot.data();
      if (
        !snapshot.exists
        || !webhook
        || webhook.ownerId !== ownerId
        || webhook.agentId !== agent.agentId
      ) {
        return false;
      }
      if (webhook.status !== 'revoked') {
        const now = getServerTimestamp();
        transaction.update(webhookRef, { status: 'revoked', updatedAt: now, revokedAt: now });
        writeAgentActivity(firestore, transaction, {
          ownerId,
          agentId: agent.agentId,
          actorId: ownerId,
          action: 'agent.webhook.revoked',
          details: { webhookId },
        });
      }
      return true;
    });
    return removed
      ? apiSuccess({ webhookId, status: 'revoked' })
      : apiError(404, 'AGENT_WEBHOOK_NOT_FOUND', 'Agent webhook was not found.');
  } catch (error: unknown) {
    console.error('Failed to revoke agent webhook.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent webhook could not be revoked.');
  }
}
