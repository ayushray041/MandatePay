import 'server-only';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { MandateError } from '@/lib/mandates/errors';

export async function assertDelegatedAgentsRegistered(
  firestore: Firestore,
  transaction: Transaction,
  primaryAgentUid: string,
  delegatedAgentIds: string[],
): Promise<void> {
  if (delegatedAgentIds.length === 0) {
    return;
  }

  const identityRefs = delegatedAgentIds.map((agentId) =>
    firestore.collection('agentIdentities').doc(agentId));
  const identities = await Promise.all(identityRefs.map((reference) => transaction.get(reference)));
  if (identities.some((identity, index) => {
    const data = identity.data();
    return !identity.exists || data?.agentId !== delegatedAgentIds[index]
      || typeof data?.agentUid !== 'string'
      || data.agentUid === primaryAgentUid;
  })) {
    throw new MandateError(
      422,
      'INVALID_DELEGATED_AGENT',
      'Every delegated agent must be a registered agent distinct from the assigned agent.',
    );
  }

  const identityByOwner = new Map<string, string>();
  for (const identity of identities) {
    const data = identity.data();
    if (typeof data?.agentUid === 'string' && typeof data.agentId === 'string') {
      identityByOwner.set(data.agentUid, data.agentId);
    }
  }
  if (identityByOwner.size !== identities.length) {
    throw new MandateError(
      422,
      'INVALID_DELEGATED_AGENT',
      'Delegated agent identities must belong to distinct owners.',
    );
  }
  const ownerIds = [...identityByOwner.keys()];
  const profileRefs = ownerIds.map((ownerId) => firestore.collection('agents').doc(ownerId));
  const profiles = await Promise.all(profileRefs.map((reference) => transaction.get(reference)));
  if (profiles.some((profile, index) => {
    const data = profile.data();
    return !profile.exists
      || data?.ownerId !== ownerIds[index]
      || data?.agentId !== identityByOwner.get(ownerIds[index])
      || data?.status !== 'active';
  })) {
    throw new MandateError(
      422,
      'INVALID_DELEGATED_AGENT',
      'Every delegated agent must have an active, owner-matched profile.',
    );
  }

  const primaryProfile = await transaction.get(firestore.collection('agents').doc(primaryAgentUid));
  const primaryAgentId = primaryProfile.data()?.agentId;
  if (typeof primaryAgentId === 'string' && delegatedAgentIds.includes(primaryAgentId)) {
    throw new MandateError(
      422,
      'INVALID_DELEGATED_AGENT',
      'The assigned agent cannot also be listed as a delegated agent.',
    );
  }
}
