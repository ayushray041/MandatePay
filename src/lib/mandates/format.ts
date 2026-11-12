import { mandateStatusSchema, type MandateStatus } from '@/models/mandate';

type TimestampLike = {
  toDate?: () => Date;
};

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
  return {
    ...data,
    id,
    startsAt: timestampToIso(data.startsAt),
    expiresAt: timestampToIso(data.expiresAt),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    status: effectiveMandateStatus(status, data.expiresAt, now),
  };
}
