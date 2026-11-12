import { mandateStatusSchema, type MandateStatus } from '@/models/mandate';

type TimestampLike = {
  toDate?: () => Date;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

export function timestampToIso(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const toDate = (value as TimestampLike).toDate;
    if (typeof toDate === 'function') {
      return toDate().toISOString();
    }
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  }

  return null;
}

export function effectiveMandateStatus(
  status: MandateStatus,
  expiresAt: unknown,
  now = new Date(),
): MandateStatus {
  const expiry = timestampToIso(expiresAt);
  if (
    (status === 'active' || status === 'paused')
    && expiry !== null
    && Date.parse(expiry) <= now.getTime()
  ) {
    return 'expired';
  }

  return status;
}

export function formatMandate(
  id: string,
  data: Record<string, unknown>,
  now = new Date(),
): Record<string, unknown> {
  const status = mandateStatusSchema.parse(data.status);
  const renewalRequestData = asRecord(data.renewalRequest);
  const renewalRequest = renewalRequestData
      ? {
        ...renewalRequestData,
        requestedExpiresAt: timestampToIso(renewalRequestData.requestedExpiresAt),
        requestedAt: timestampToIso(renewalRequestData.requestedAt),
      }
      : data.renewalRequest ?? null;
  const emergencySuspensionData = asRecord(data.emergencySuspension);
  const emergencySuspension = emergencySuspensionData
      ? {
        ...emergencySuspensionData,
        suspendedAt: timestampToIso(emergencySuspensionData.suspendedAt),
      }
      : data.emergencySuspension ?? null;
  return {
    ...data,
    id,
    startsAt: timestampToIso(data.startsAt),
    expiresAt: timestampToIso(data.expiresAt),
    renewalRequest,
    emergencySuspension,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    status: effectiveMandateStatus(status, data.expiresAt, now),
  };
}
