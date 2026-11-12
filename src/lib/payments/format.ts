import { timestampToIso } from '@/lib/mandates/format';

export function formatPayment(id: string, data: Record<string, unknown>) {
  const publicData = { ...data };
  delete publicData.idempotencyKeyHash;
  return {
    ...publicData,
    id,
    mandateApproval: {
      ...(typeof data.mandateApproval === 'object' && data.mandateApproval !== null
        ? data.mandateApproval
        : {}),
      approvedAt: timestampToIso(
        (data.mandateApproval as Record<string, unknown> | undefined)?.approvedAt,
      ),
    },
    authorizedAt: timestampToIso(data.authorizedAt),
    completedAt: timestampToIso(data.completedAt),
    cancelledAt: timestampToIso(data.cancelledAt),
    refundedAt: timestampToIso(data.refundedAt),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export function formatPaymentEvent(id: string, data: Record<string, unknown>) {
  return {
    ...data,
    id,
    createdAt: timestampToIso(data.createdAt),
  };
}
