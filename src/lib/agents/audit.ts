import 'server-only';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { timestampToIso } from '@/lib/mandates/format';
import { agentApiKeyRecordSchema, type AgentApiKeyRecord } from '@/models/agent-iam';

type AgentEvent = {
  ownerId: string;
  agentId: string;
  actorId: string;
  action: string;
  details?: Record<string, string | number | boolean | null>;
};

export function writeAgentActivity(
  firestore: Firestore,
  transaction: Transaction,
  event: AgentEvent,
): void {
  const eventRef = firestore.collection('agentActivity').doc();
  transaction.create(eventRef, {
    ...event,
    createdAt: getServerTimestamp(),
  });
}

export function formatAgentApiKeyRecord(
  keyId: string,
  data: Record<string, unknown>,
): AgentApiKeyRecord {
  const expiresAt = timestampToIso(data.expiresAt);
  const status = data.status === 'revoked'
    ? 'revoked'
    : data.status === 'expired' || (
      expiresAt !== null
      && Date.parse(expiresAt) <= Date.now()
    )
      ? 'expired'
      : data.status === 'active'
        ? 'active'
        : null;
  const parsed = agentApiKeyRecordSchema.safeParse({
    keyId,
    agentId: String(data.agentId ?? ''),
    name: String(data.name ?? ''),
    prefix: String(data.prefix ?? ''),
    scopes: data.scopes,
    status,
    createdAt: timestampToIso(data.createdAt),
    expiresAt,
    lastUsedAt: timestampToIso(data.lastUsedAt),
  });
  if (!parsed.success) {
    throw new Error('Stored agent API key metadata is invalid.');
  }
  return parsed.data;
}
