import { timestampToIso } from '@/lib/mandates/format';

export function formatPayment(id: string, data: Record<string, unknown>) {
  const publicData = { ...data };
  delete publicData.idempotencyKeyHash;
  delete publicData.pendingRefundKeyHash;
  delete publicData.pendingRefundId;
  delete publicData.pendingRefundAmountMinor;
  delete publicData.refundCount;
  const refundedAmountMinor = Number.isSafeInteger(data.refundedAmountMinor)
    ? Number(data.refundedAmountMinor)
    : data.status === 'refunded' && Number.isSafeInteger(data.amountMinor)
      ? Number(data.amountMinor)
      : 0;
  return {
    ...publicData,
    id,
    refundedAmountMinor,
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

export function formatPaymentRefund(id: string, data: Record<string, unknown>) {
  return {
    id,
    amountMinor: data.amountMinor,
    currency: data.currency,
    reason: data.reason,
    status: data.status,
    providerRefundId: data.providerRefundId ?? null,
    createdAt: timestampToIso(data.createdAt),
    completedAt: timestampToIso(data.completedAt),
  };
}

export function formatPaymentEvent(id: string, data: Record<string, unknown>) {
  return {
    ...data,
    id,
    createdAt: timestampToIso(data.createdAt),
  };
}
