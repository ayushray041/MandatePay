import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeAgentActivity } from '@/lib/agents/audit';
import { ensureAgentRecord } from '@/lib/agents/store';
import { agentSecuritySettingsSchema } from '@/models/agent-iam';

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
  const parsed = agentSecuritySettingsSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Agent security settings are invalid.');
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
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before changing security settings.');
    }
    const updated = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(agentRef);
      const current = snapshot.data();
      if (!snapshot.exists || !current || current.ownerId !== ownerId || current.agentId !== agent.agentId) {
        return null;
      }
      const version = Number(current.version);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error('Stored agent profile version is invalid.');
      }
      const now = getServerTimestamp();
      transaction.update(agentRef, {
        ...parsed.data,
        version: version + 1,
        updatedAt: now,
      });
      writeAgentActivity(firestore, transaction, {
        ownerId,
        agentId: agent.agentId,
        actorId: ownerId,
        action: 'agent.security_settings.updated',
        details: parsed.data,
      });
      return {
        rateLimitPerMinute: parsed.data.rateLimitPerMinute ?? current.rateLimitPerMinute,
        dailyQuota: parsed.data.dailyQuota ?? current.dailyQuota,
      };
    });
    return updated
      ? apiSuccess(updated)
      : apiError(404, 'AGENT_NOT_REGISTERED', 'Agent profile was not found.');
  } catch (error: unknown) {
    console.error('Failed to update agent security settings.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent security settings could not be changed.');
  }
}
