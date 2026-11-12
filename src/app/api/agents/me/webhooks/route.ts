import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { ensureAgentRecord } from '@/lib/agents/store';
import { writeAgentActivity } from '@/lib/agents/audit';
import { timestampToIso } from '@/lib/mandates/format';
import { agentWebhookCreateSchema } from '@/models/agent-iam';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent webhook storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before managing webhooks.');
    }
    const webhooks = await adminFirestore.collection('agentWebhooks')
      .where('ownerId', '==', ownerId)
      .where('agentId', '==', agent.agentId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return apiSuccess(webhooks.docs.map((snapshot) => {
      const webhook = snapshot.data();
      return {
        id: snapshot.id,
        url: webhook.url,
        events: webhook.events,
        status: webhook.status,
        createdAt: timestampToIso(webhook.createdAt),
        updatedAt: timestampToIso(webhook.updatedAt),
      };
    }));
  } catch (error: unknown) {
    console.error('Failed to load agent webhooks.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent webhooks could not be loaded.');
  }
}

export async function POST(request: Request) {
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
  const parsed = agentWebhookCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Agent webhook details are invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent webhook storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  const firestore = adminFirestore;
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before managing webhooks.');
    }
    const webhookRef = firestore.collection('agentWebhooks').doc();
    const now = getServerTimestamp();
    const webhook = {
      ownerId,
      agentId: agent.agentId,
      url: parsed.data.url,
      events: parsed.data.events,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await firestore.runTransaction(async (transaction) => {
      const agentSnapshot = await transaction.get(firestore.collection('agents').doc(ownerId));
      const current = agentSnapshot.data();
      if (!agentSnapshot.exists || !current || current.ownerId !== ownerId || current.agentId !== agent.agentId) {
        throw new Error('Agent ownership changed while registering a webhook.');
      }
      transaction.create(webhookRef, webhook);
      writeAgentActivity(firestore, transaction, {
        ownerId,
        agentId: agent.agentId,
        actorId: ownerId,
        action: 'agent.webhook.registered',
        details: { webhookId: webhookRef.id, events: parsed.data.events.join(',') },
      });
    });
    return apiSuccess({
      id: webhookRef.id,
      url: webhook.url,
      events: webhook.events,
      status: webhook.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, 201);
  } catch (error: unknown) {
    console.error('Failed to register agent webhook.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent webhook could not be registered.');
  }
}
