import { timestampToIso } from '@/lib/mandates/format';
import { contractExpiryStatus } from '@/lib/contracts/policy';

export function formatContract(id: string, data: Record<string, unknown>) {
  return {
    ...data,
    id,
    status: contractExpiryStatus(data.status, data.expiresAt),
    expiresAt: timestampToIso(data.expiresAt),
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
