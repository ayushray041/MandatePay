import 'server-only';
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { getServerTimestamp } from '@/lib/firebase/firestore';

type CaptureOutcome = 'success' | 'failure';

function storedCount(value: unknown, field: string): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Stored marketplace metric ${field} is invalid.`);
  }
  return value;
}

export async function recordMarketplaceCaptureOutcome(
  firestore: Firestore,
  transaction: Transaction,
  payeeUid: string,
  paymentId: string,
  outcome: CaptureOutcome,
  outcomeKey: string,
): Promise<void> {
  const agentRef = firestore.collection('agents').doc(payeeUid);
  const agentSnapshot = await transaction.get(agentRef);
  const agent = agentSnapshot.data();
  if (!agentSnapshot.exists || !agent || typeof agent.agentId !== 'string') {
    return;
  }
  const agentId = agent.agentId;
  if (!/^agt_[A-Za-z0-9_-]{32}$/.test(agentId) || agent.ownerId !== payeeUid) {
    throw new Error('Stored payee agent identity is invalid.');
  }
  const identityRef = firestore.collection('agentIdentities').doc(agentId);
  const metricsRef = firestore.collection('marketplaceAgentMetrics').doc(agentId);
  const outcomeId = createHash('sha256')
    .update(`${paymentId}:${outcomeKey}`)
    .digest('hex');
  const outcomeRef = firestore.collection('marketplacePaymentOutcomes').doc(outcomeId);
  const [identitySnapshot, metricsSnapshot, previousOutcome] = await Promise.all([
    transaction.get(identityRef),
    transaction.get(metricsRef),
    transaction.get(outcomeRef),
  ]);
  if (
    !identitySnapshot.exists
    || identitySnapshot.data()?.agentUid !== payeeUid
    || previousOutcome.exists
  ) {
    return;
  }

  const metrics = metricsSnapshot.data() ?? {};
  const successfulCaptureAttempts = storedCount(
    metrics.successfulCaptureAttempts,
    'successfulCaptureAttempts',
  );
  const failedCaptureAttempts = storedCount(metrics.failedCaptureAttempts, 'failedCaptureAttempts');
  const completedTransactions = storedCount(metrics.completedTransactions, 'completedTransactions');
  const now = getServerTimestamp();
  transaction.create(outcomeRef, {
    paymentId,
    agentId,
    outcome,
    createdAt: now,
  });
  transaction.set(metricsRef, {
    agentId,
    ...(outcome === 'success'
      ? {
        completedTransactions: completedTransactions + 1,
        successfulCaptureAttempts: successfulCaptureAttempts + 1,
      }
      : { failedCaptureAttempts: failedCaptureAttempts + 1 }),
    updatedAt: now,
  }, { merge: true });
}
