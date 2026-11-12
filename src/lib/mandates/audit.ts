import type {
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { getServerTimestamp } from '@/lib/firebase/firestore';

type MandateAuditEvent = {
  mandateId: string;
  action: string;
  performedBy: string;
  payload: Record<string, unknown>;
};

export function writeMandateAuditEvent(
  firestore: Firestore,
  transaction: Transaction,
  event: MandateAuditEvent,
): void {
  const auditRef = firestore.collection('auditLogs').doc();
  transaction.create(auditRef, {
    entity: 'mandate',
    entityId: event.mandateId,
    action: event.action,
    performedBy: event.performedBy,
    payload: event.payload,
    timestamp: getServerTimestamp(),
  });
}
