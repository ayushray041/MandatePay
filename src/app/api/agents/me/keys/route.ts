import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { ensureAgentRecord } from '@/lib/agents/store';
import { generateAgentApiKey } from '@/lib/agents/credentials';
import { formatAgentApiKeyRecord, writeAgentActivity } from '@/lib/agents/audit';
import { agentApiKeyCreateSchema } from '@/models/agent-iam';

const maximumKeyLifetimeMs = 366 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent credential storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before managing credentials.');
    }
    const keys = await adminFirestore.collection('agentApiKeys')
      .where('ownerId', '==', ownerId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return apiSuccess(keys.docs
      .filter((snapshot) => snapshot.data().agentId === agent.agentId)
      .map((snapshot) => formatAgentApiKeyRecord(snapshot.id, snapshot.data())));
  } catch (error: unknown) {
    console.error('Failed to list agent credentials.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent credentials could not be loaded.');
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
  const parsed = agentApiKeyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Agent credential details are invalid.');
  }
  const expiresAt = new Date(parsed.data.expiresAt);
  const now = new Date();
  if (
    !Number.isFinite(expiresAt.getTime())
    || expiresAt <= now
    || expiresAt.getTime() > now.getTime() + maximumKeyLifetimeMs
  ) {
    return apiError(
      422,
      'INVALID_EXPIRATION',
      'Credentials must expire in the future and within one year.',
    );
  }
  const generated = generateAgentApiKey();
  if (!generated) {
    return apiError(
      503,
      'CREDENTIALS_NOT_CONFIGURED',
      'Agent credential issuance requires AGENT_API_KEY_PEPPER to be configured.',
    );
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent credential storage is unavailable.');
  }

  const ownerId = authentication.user.uid;
  const firestore = adminFirestore;
  const keyRef = firestore.collection('agentApiKeys').doc(generated.keyId);
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before creating credentials.');
    }
    const nowTimestamp = getServerTimestamp();
    await firestore.runTransaction(async (transaction) => {
      const [agentSnapshot, keySnapshot] = await Promise.all([
        transaction.get(firestore.collection('agents').doc(ownerId)),
        transaction.get(keyRef),
      ]);
      const storedAgent = agentSnapshot.data();
      if (
        !agentSnapshot.exists
        || !storedAgent
        || storedAgent.ownerId !== ownerId
        || storedAgent.agentId !== agent.agentId
      ) {
        throw new Error('Agent ownership changed while issuing credentials.');
      }
      if (keySnapshot.exists) {
        throw new Error('Generated credential identifier collided with an existing key.');
      }
      transaction.create(keyRef, {
        keyId: generated.keyId,
        agentId: agent.agentId,
        ownerId,
        name: parsed.data.name,
        prefix: generated.prefix,
        tokenHash: generated.tokenHash,
        scopes: parsed.data.scopes,
        status: 'active',
        createdAt: nowTimestamp,
        expiresAt,
        lastUsedAt: null,
        revokedAt: null,
      });
      writeAgentActivity(firestore, transaction, {
        ownerId,
        agentId: agent.agentId,
        actorId: ownerId,
        action: 'agent.api_key.created',
        details: { keyId: generated.keyId, scopes: parsed.data.scopes.join(',') },
      });
    });

    return apiSuccess({
      key: {
        keyId: generated.keyId,
        agentId: agent.agentId,
        name: parsed.data.name,
        prefix: generated.prefix,
        scopes: parsed.data.scopes,
        status: 'active',
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastUsedAt: null,
      },
      secret: generated.token,
      warning: 'Copy this secret now. It cannot be retrieved again.',
    }, 201);
  } catch (error: unknown) {
    console.error('Failed to create agent credential.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent credential could not be created.');
  }
}
