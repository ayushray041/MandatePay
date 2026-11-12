import { timestampToIso } from '@/lib/mandates/format';
import { negotiationStatusSchema } from '@/models/negotiation';

export function formatNegotiation(
  id: string,
  data: Record<string, unknown>,
  now = new Date(),
) {
  const status = negotiationStatusSchema.parse(data.status);
  const expiresAt = timestampToIso(data.expiresAt);
  const expired = expiresAt !== null
    && Date.parse(expiresAt) <= now.getTime()
    && !['accepted', 'rejected', 'expired', 'cancelled'].includes(status);
  const currentOffer =
    typeof data.currentOffer === 'object' && data.currentOffer !== null
      ? {
          ...(data.currentOffer as Record<string, unknown>),
          createdAt: timestampToIso(
            (data.currentOffer as Record<string, unknown>).createdAt,
          ),
        }
      : null;

  return {
    ...data,
    id,
    status: expired ? 'expired' : status,
    expiresAt,
    currentOffer,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    acceptedAt: timestampToIso(data.acceptedAt),
  };
}

export function formatNegotiationOffer(id: string, data: Record<string, unknown>) {
  return {
    ...data,
    id,
    createdAt: timestampToIso(data.createdAt),
  };
}

export function formatNegotiationEvent(id: string, data: Record<string, unknown>) {
  return {
    ...data,
    id,
    createdAt: timestampToIso(data.createdAt),
  };
}
