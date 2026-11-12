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

export function formatNegotiationForViewer(
  id: string,
  data: Record<string, unknown>,
  viewerId: string,
  now = new Date(),
) {
  const requiredOwnerApprovalIds = Array.isArray(data.requiredOwnerApprovalIds)
    ? data.requiredOwnerApprovalIds.filter((ownerId): ownerId is string => typeof ownerId === 'string')
    : [];
  const ownerApprovals = Array.isArray(data.ownerApprovals)
    ? data.ownerApprovals.filter((ownerId): ownerId is string => typeof ownerId === 'string')
    : [];
  const publicData = { ...data };
  delete publicData.requiredOwnerApprovalIds;
  delete publicData.ownerApprovals;
  const publicNegotiation = formatNegotiation(id, publicData, now);
  return {
    ...publicNegotiation,
    ownerApprovalRequired: requiredOwnerApprovalIds.length > 0,
    ...(requiredOwnerApprovalIds.includes(viewerId)
      ? {
          ownerApprovalRequiredForViewer: true,
          ownerApprovalRecordedForViewer: ownerApprovals.includes(viewerId),
        }
      : {}),
  };
}

export function formatNegotiationOffer(id: string, data: Record<string, unknown>) {
  return {
    ...data,
    id,
    createdAt: timestampToIso(data.createdAt),
  };
}

export function formatNegotiationEvent(
  id: string,
  data: Record<string, unknown>,
): Record<string, unknown> & { id: string; createdAt: string | null } {
  return {
    ...data,
    id,
    actorType: typeof data.actorOwnerId === 'string'
      ? 'owner'
      : typeof data.actorSystemId === 'string'
        ? 'system'
        : 'agent',
    createdAt: timestampToIso(data.createdAt),
  };
}

export function formatNegotiationSnapshot(
  data: Record<string, unknown>,
  viewerId: string,
  participantAgentIds: string[],
) {
  const currentOffer =
    typeof data.currentOffer === 'object' && data.currentOffer !== null
      ? {
          ...(data.currentOffer as Record<string, unknown>),
          createdAt: timestampToIso((data.currentOffer as Record<string, unknown>).createdAt),
        }
      : null;
  return {
    ...data,
    actorId: data.actorId === 'system:negotiation-expiry-worker'
      ? 'system'
      : data.actorId === viewerId
        ? 'you'
        : participantAgentIds.includes(String(data.actorId))
          ? 'agent_participant'
          : 'mandate_owner',
    currentOffer,
    updatedAt: timestampToIso(data.updatedAt),
    createdAt: timestampToIso(data.createdAt),
  };
}
