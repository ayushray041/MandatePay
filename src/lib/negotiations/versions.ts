import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { getServerTimestamp } from '@/lib/firebase/firestore';

type VersionedNegotiation = {
  version?: unknown;
};

export function nextNegotiationVersion(negotiation: VersionedNegotiation): number {
  const current = negotiation.version === undefined ? 1 : Number(negotiation.version);
  if (!Number.isSafeInteger(current) || current < 1 || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Negotiation version is invalid.');
  }
  return current + 1;
}

export function writeNegotiationSnapshot(
  transaction: Transaction,
  negotiationRef: DocumentReference,
  input: {
    version: number;
    status: string;
    currentOfferId: string | null;
    currentOffer: unknown;
    offerCount: number;
    updatedAt: unknown;
    actorId: string;
  },
): void {
  const snapshotRef = negotiationRef.collection('versions')
    .doc(String(input.version).padStart(6, '0'));
  transaction.create(snapshotRef, {
    ...input,
    createdAt: getServerTimestamp(),
  });
}
