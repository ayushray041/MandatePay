import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { ensureAgentRecord } from '@/lib/agents/store';
import { generateAgentApiKey } from '@/lib/agents/credentials';
import { writeAgentActivity } from '@/lib/agents/audit';
import { timestampToIso } from '@/lib/mandates/format';
import { agentApiKeyCreateSchema } from '@/models/agent-iam';

type RouteContext = { params: Promise<{ keyId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent credential storage is unavailable.');
  }

  const { keyId } = await context.params;
  if (!/^[A-Za-z0-9_-]{16}$/.test(keyId)) {
    return apiError(404, 'AGENT_KEY_NOT_FOUND', 'Agent credential was not found.');
  }
  const generated = generateAgentApiKey();
  if (!generated) {
    return apiError(
      503,
      'CREDENTIALS_NOT_CONFIGURED',
      'Agent credential issuance requires AGENT_API_KEY_PEPPER to be configured.',
    );
  }

  const ownerId = authentication.user.uid;
  const firestore = adminFirestore;
  const oldKeyRef = firestore.collection('agentApiKeys').doc(keyId);
  const newKeyRef = firestore.collection('agentApiKeys').doc(generated.keyId);
  const sessionRef = firestore.collection('agentSessions').doc(keyId);
  try {
    const agent = await ensureAgentRecord(ownerId);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before rotating credentials.');
    }
    const now = new Date();
    const result = await firestore.runTransaction(async (transaction) => {
      const [oldKeySnapshot, newKeySnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(oldKeyRef),
        transaction.get(newKeyRef),
        transaction.get(sessionRef),
      ]);
      const oldKey = oldKeySnapshot.data();
      const expiresAt = timestampToIso(oldKey?.expiresAt);
      if (
        !oldKeySnapshot.exists
        || !oldKey
        || oldKey.ownerId !== ownerId
        || oldKey.agentId !== agent.agentId
        || oldKey.status !== 'active'
        || !expiresAt
        || Date.parse(expiresAt) <= now.getTime()
      ) {
        return null;
      }
      const validatedOldKey = agentApiKeyCreateSchema.safeParse({
        name: oldKey.name,
        scopes: oldKey.scopes,
        expiresAt,
      });
      if (!validatedOldKey.success) {
        throw new Error('Stored agent credential metadata is invalid.');
      }
      if (newKeySnapshot.exists) {
        throw new Error('Generated credential identifier collided with an existing key.');
      }
      const timestamp = getServerTimestamp();
      transaction.update(oldKeyRef, { status: 'revoked', revokedAt: timestamp });
      if (sessionSnapshot.exists) {
        transaction.update(sessionRef, { status: 'revoked', revokedAt: timestamp });
      }
      transaction.create(newKeyRef, {
        keyId: generated.keyId,
        agentId: agent.agentId,
        ownerId,
        name: validatedOldKey.data.name,
        prefix: generated.prefix,
        tokenHash: generated.tokenHash,
        scopes: validatedOldKey.data.scopes,
        status: 'active',
        createdAt: timestamp,
        expiresAt: oldKey.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
      });
      writeAgentActivity(firestore, transaction, {
        ownerId,
        agentId: agent.agentId,
        actorId: ownerId,
        action: 'agent.api_key.rotated',
        details: { oldKeyId: keyId, newKeyId: generated.keyId },
      });
      return {
        expiresAt,
        scopes: validatedOldKey.data.scopes,
        name: validatedOldKey.data.name,
      };
    });
    if (!result) {
      return apiError(404, 'AGENT_KEY_NOT_FOUND', 'Active agent credential was not found.');
    }
    return apiSuccess({
      key: {
        keyId: generated.keyId,
        agentId: agent.agentId,
        name: result.name,
        prefix: generated.prefix,
        scopes: result.scopes,
        status: 'active',
        createdAt: now.toISOString(),
        expiresAt: result.expiresAt,
        lastUsedAt: null,
      },
      secret: generated.token,
      warning: 'Copy this secret now. It cannot be retrieved again.',
    }, 201);
  } catch (error: unknown) {
    console.error('Failed to rotate agent credential.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent credential could not be rotated.');
  }
}
