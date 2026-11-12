import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { generateAgentId } from '@/lib/agents/credentials';
import { ensureAgentRecord, formatAgentRecord } from '@/lib/agents/store';
import { writeAgentActivity } from '@/lib/agents/audit';
import {
  agentProfileCreateSchema,
  agentProfileUpdateSchema,
} from '@/models/agent';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent storage is unavailable.');
  }

  try {
    const agent = await ensureAgentRecord(authentication.user.uid);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent profile to continue.');
    }
    return apiSuccess(agent);
  } catch (error: unknown) {
    console.error('Failed to load agent profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent profile could not be loaded.');
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
  const parsed = agentProfileCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Agent profile details are invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent storage is unavailable.');
  }

  const firestore = adminFirestore;
  const uid = authentication.user.uid;
  const userRef = firestore.collection('users').doc(uid);
  const agentRef = firestore.collection('agents').doc(uid);
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const [userSnapshot, agentSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(agentRef),
      ]);
      if (!userSnapshot.exists) {
        return { ok: false as const, error: 'PROFILE_NOT_FOUND' as const };
      }
      const user = userSnapshot.data();
      if (!user) {
        throw new Error('User profile document has no data.');
      }
      if (user.role !== 'freelancer') {
        return { ok: false as const, error: 'AGENT_ROLE_REQUIRED' as const };
      }
      if (typeof user.displayName !== 'string' || user.displayName.trim() === '') {
        throw new Error('Registered user profile has no valid display name.');
      }
      if (agentSnapshot.exists) {
        return { ok: false as const, error: 'AGENT_ALREADY_REGISTERED' as const };
      }

      const now = getServerTimestamp();
      const agentId = generateAgentId();
      const identityRef = firestore.collection('agentIdentities').doc(agentId);
      const identitySnapshot = await transaction.get(identityRef);
      if (identitySnapshot.exists) {
        return { ok: false as const, error: 'AGENT_ID_COLLISION' as const };
      }
      const agent = {
        ...parsed.data,
        uid,
        agentId,
        ownerId: uid,
        displayName: user.displayName,
        status: 'active',
        healthStatus: 'unknown',
        version: 1,
        runtimeVersion: null,
        rateLimitPerMinute: 60,
        dailyQuota: 10_000,
        lastSeenAt: null,
        createdAt: now,
        updatedAt: now,
      };
      transaction.create(agentRef, agent);
      transaction.create(identityRef, {
        agentId,
        ownerId: uid,
        agentUid: uid,
        createdAt: now,
      });
      writeAgentActivity(firestore, transaction, {
        ownerId: uid,
        agentId,
        actorId: uid,
        action: 'agent.registered',
      });
      return { ok: true as const, agent };
    });

    if (!result.ok) {
      if (result.error === 'PROFILE_NOT_FOUND') {
        return apiError(404, result.error, 'Create a user profile before registering as an agent.');
      }
      if (result.error === 'AGENT_ROLE_REQUIRED') {
        return apiError(403, result.error, 'A freelancer profile is required to register as an agent.');
      }
      if (result.error === 'AGENT_ID_COLLISION') {
        return apiError(503, result.error, 'Agent identity allocation collided; retry registration.');
      }
      return apiError(409, result.error, 'This account already has an agent profile.');
    }
    return apiSuccess(formatAgentRecord(uid, result.agent), 201);
  } catch (error: unknown) {
    console.error('Failed to register agent profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent profile could not be registered.');
  }
}

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
  const parsed = agentProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Agent profile update is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Agent storage is unavailable.');
  }

  const uid = authentication.user.uid;
  const firestore = adminFirestore;
  const agentRef = firestore.collection('agents').doc(uid);
  try {
    const agent = await ensureAgentRecord(uid);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent profile before updating it.');
    }
    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(agentRef);
      if (!snapshot.exists) {
        return { ok: false as const, error: 'AGENT_NOT_REGISTERED' as const };
      }
      const current = snapshot.data();
      if (!current) {
        throw new Error('Agent profile document has no data.');
      }
      const merged = agentProfileCreateSchema.safeParse({
        headline: current.headline,
        bio: current.bio,
        categories: current.categories,
        capabilities: current.capabilities,
        supportedCurrencies: current.supportedCurrencies,
        availability: current.availability,
        ...parsed.data,
      });
      if (!merged.success) {
        return { ok: false as const, error: 'INVALID_AGENT_PROFILE' as const };
      }
      const version = Number(current.version);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error('Stored agent profile version is invalid.');
      }
      transaction.update(agentRef, {
        ...parsed.data,
        version: version + 1,
        updatedAt: getServerTimestamp(),
      });
      writeAgentActivity(firestore, transaction, {
        ownerId: uid,
        agentId: agent.agentId,
        actorId: uid,
        action: 'agent.profile.updated',
        details: { updatedFields: Object.keys(parsed.data).join(',') },
      });
      return { ok: true as const };
    });

    if (!result.ok) {
      if (result.error === 'AGENT_NOT_REGISTERED') {
        return apiError(404, result.error, 'Register an agent profile before updating it.');
      }
      return apiError(
        400,
        result.error,
        'The profile update would create an invalid capability profile.',
      );
    }

    const updated = await agentRef.get();
    const data = updated.data();
    if (!data) {
      throw new Error('Updated agent profile could not be read.');
    }
    return apiSuccess(formatAgentRecord(uid, data));
  } catch (error: unknown) {
    console.error('Failed to update agent profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent profile could not be updated.');
  }
}
