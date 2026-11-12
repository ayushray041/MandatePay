import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { getServerTimestamp } from '@/lib/firebase/firestore';

type PaymentEventInput = {
  sequence: number;
  type: string;
  source: 'api' | 'webhook' | 'system';
  actorId: string | null;
  providerEventId?: string | null;
  details?: Record<string, unknown>;
};

export function writePaymentEvent(
  firestore: Firestore,
  transaction: Transaction,
  paymentRef: DocumentReference,
  event: PaymentEventInput,
): void {
  transaction.create(paymentRef.collection('events').doc(), {
    ...event,
    providerEventId: event.providerEventId ?? null,
    createdAt: getServerTimestamp(),
  });
}
