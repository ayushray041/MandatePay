import 'server-only';
import { adminFirestore } from '@/lib/firebase/admin';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { timestampToIso } from '@/lib/mandates/format';
import { generateAgentId } from '@/lib/agents/credentials';
import { agentProfileSchema, type AgentProfile } from '@/models/agent';

export async function ensureAgentRecord(ownerId: string): Promise<AgentProfile | null> {
  if (!adminFirestore) {
    throw new Error('Agent storage is unavailable.');
  }

  const firestore = adminFirestore;
  const agentRef = firestore.collection('agents').doc(ownerId);
  const generatedAgentId = generateAgentId();
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(agentRef);
    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data();
    if (!data) {
      throw new Error('Agent profile document has no data.');
    }
    if (data.ownerId !== undefined && data.ownerId !== ownerId) {
      throw new Error('Agent profile owner does not match the authenticated account.');
    }

    const lastSeenAt = data.lastSeenAt === undefined ? null : timestampToIso(data.lastSeenAt);
    const lastSeenTime = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
    const observedRecently = Number.isFinite(lastSeenTime)
      && lastSeenTime <= Date.now()
      && Date.now() - lastSeenTime <= 5 * 60_000;
    const defaults: Record<string, unknown> = {
      agentId: data.agentId === undefined ? generatedAgentId : data.agentId,
      ownerId,
      status: data.status ?? 'active',
      healthStatus: data.status !== 'suspended' && data.healthStatus === 'healthy' && observedRecently
        ? 'healthy'
        : 'unknown',
      version: data.version ?? 1,
      runtimeVersion: data.runtimeVersion ?? null,
      rateLimitPerMinute: data.rateLimitPerMinute ?? 60,
      dailyQuota: data.dailyQuota ?? 10_000,
      lastSeenAt,
    };
    if (typeof defaults.agentId !== 'string' || !/^agt_[A-Za-z0-9_-]{32}$/.test(defaults.agentId)) {
      throw new Error('Stored agent identity is invalid.');
    }
    const identityRef = firestore.collection('agentIdentities').doc(defaults.agentId);
    const identitySnapshot = await transaction.get(identityRef);
    const registeredIdentity = identitySnapshot.data();
    if (
      identitySnapshot.exists
      && (
        !registeredIdentity
        || registeredIdentity.ownerId !== ownerId
        || registeredIdentity.agentUid !== ownerId
      )
    ) {
      throw new Error('Agent identity is already associated with another owner.');
    }
    const updates = Object.fromEntries(
      Object.entries(defaults).filter(([key, value]) => data[key] !== value),
    );
    if (Object.keys(updates).length > 0) {
      transaction.update(agentRef, {
        ...updates,
        updatedAt: getServerTimestamp(),
      });
    }
    if (!identitySnapshot.exists) {
      transaction.create(identityRef, {
        agentId: defaults.agentId,
        ownerId,
        agentUid: ownerId,
        createdAt: getServerTimestamp(),
      });
    }

    return formatAgentRecord(ownerId, { ...data, ...defaults });
  });
}

export function formatAgentRecord(
  uid: string,
  data: Record<string, unknown>,
): AgentProfile {
  const parsed = agentProfileSchema.safeParse({
    uid,
    agentId: data.agentId,
    ownerId: data.ownerId ?? uid,
    displayName: data.displayName,
    headline: data.headline,
    bio: data.bio,
    categories: data.categories,
    capabilities: data.capabilities,
    supportedCurrencies: data.supportedCurrencies,
    availability: data.availability,
    status: data.status,
    healthStatus: data.healthStatus,
    version: data.version,
    runtimeVersion: data.runtimeVersion,
    rateLimitPerMinute: data.rateLimitPerMinute,
    dailyQuota: data.dailyQuota,
    lastSeenAt: timestampToIso(data.lastSeenAt),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  });
  if (!parsed.success) {
    throw new Error('Stored agent profile is invalid.');
  }
  return parsed.data;
}
