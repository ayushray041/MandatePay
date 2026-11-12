import { timestampToIso } from '@/lib/mandates/format';
import { contractExpiryStatus } from '@/lib/contracts/policy';

export function formatContract(id: string, data: Record<string, unknown>) {
  const status = contractExpiryStatus(data.status, data.expiresAt);
  const expiresAt = timestampToIso(data.expiresAt);
  const daysUntilExpiry = expiresAt === null
    ? null
    : Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000);
  return {
    ...data,
    id,
    status,
    expiresAt,
    renewalReminderDaysRemaining: status === 'active'
      && daysUntilExpiry !== null
      && daysUntilExpiry >= 0
      && daysUntilExpiry <= 30
      ? daysUntilExpiry
      : null,
    activatedAt: timestampToIso(data.activatedAt),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export function formatContractVersion(id: string, data: Record<string, unknown>) {
  return {
    ...data,
    id,
    createdAt: timestampToIso(data.createdAt),
  };
}

export function formatContractAmendment(id: string, data: Record<string, unknown>) {
  return {
    ...data,
    id,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export function formatContractEvent(id: string, data: Record<string, unknown>) {
  return {
    ...data,
    id,
    createdAt: timestampToIso(data.createdAt),
  };
}
