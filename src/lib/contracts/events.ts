import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { getServerTimestamp } from '@/lib/firebase/firestore';

type ContractEvent = {
  sequence: number;
  type: string;
  actorId: string;
  amendmentId?: string;
  versionId?: string;
  details?: Record<string, unknown>;
};

export function writeContractEvent(
  transaction: Transaction,
  contractRef: DocumentReference,
  event: ContractEvent,
): void {
  const eventRef = contractRef.collection('events').doc();
  transaction.create(eventRef, {
    ...event,
    createdAt: getServerTimestamp(),
  });
}
