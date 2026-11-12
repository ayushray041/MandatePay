import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeAgentActivity } from '@/lib/agents/audit';
import { ensureAgentRecord } from '@/lib/agents/store';
import { agentStatusUpdateSchema } from '@/models/agent-iam';

export async function PATCH(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  const parsed = agentStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Agent status is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  const firestore = adminFirestore;
  const agentRef = firestore.collection('agents').doc(ownerId);
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before changing its status.');
    }
    const changed = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(agentRef);
      const current = snapshot.data();
      if (!snapshot.exists || !current || current.ownerId !== ownerId || current.agentId !== agent.agentId) {
        return false;
      }
      if (current.status === parsed.data.status) {
        return true;
      }
      const now = getServerTimestamp();
      const version = Number(current.version);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error('Stored agent profile version is invalid.');
      }
      transaction.update(agentRef, {
        status: parsed.data.status,
        healthStatus: 'unknown',
        version: version + 1,
        updatedAt: now,
      });
      writeAgentActivity(firestore, transaction, {
        ownerId,
        agentId: agent.agentId,
        actorId: ownerId,
        action: parsed.data.status === 'suspended' ? 'agent.suspended' : 'agent.activated',
        details: { status: parsed.data.status },
      });
      return true;
    });
    if (!changed) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Agent profile was not found.');
    }
    return apiSuccess({ status: parsed.data.status });
  } catch (error: unknown) {
    console.error('Failed to update agent status.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent status could not be changed.');
  }
}
