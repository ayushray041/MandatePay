import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { getServerTimestamp } from '@/lib/firebase/firestore';

type EventInput = {
  sequence: number;
  type: string;
  offerId?: string;
  details?: Record<string, unknown>;
} & (
  | { actorAgentId: string; actorOwnerId?: never; actorSystemId?: never }
  | { actorOwnerId: string; actorAgentId?: never; actorSystemId?: never }
  | { actorSystemId: string; actorAgentId?: never; actorOwnerId?: never }
);

export function writeNegotiationEvent(
  transaction: Transaction,
  negotiationRef: DocumentReference,
  event: EventInput,
): void {
  const eventRef = negotiationRef.collection('events').doc();
  transaction.create(eventRef, {
    ...event,
    createdAt: getServerTimestamp(),
  });
}
