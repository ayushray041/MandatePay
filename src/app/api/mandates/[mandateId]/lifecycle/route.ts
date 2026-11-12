import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { formatMandate, timestampToIso } from '@/lib/mandates/format';
import { assertOwner, mandateStatus } from '@/lib/mandates/policy';
import { mandateLifecycleActionSchema } from '@/models/mandate';

type RouteContext = { params: Promise<{ mandateId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const parsed = mandateLifecycleActionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Lifecycle action is invalid.');
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  const firestore = adminFirestore;
  const mandateRef = firestore.collection('mandates').doc(mandateId);
  try {
    const expired = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(mandateRef);
      if (!snapshot.exists) {
        throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
      }

      const mandate = snapshot.data();
      if (!mandate) {
        throw new Error('Mandate document has no data.');
      }

      assertOwner(mandate, authentication.user.uid);
      const currentStatus = mandateStatus(mandate);
      const now = new Date();
      const expiresAt = timestampToIso(mandate.expiresAt);
      const startsAt = timestampToIso(mandate.startsAt);
      const expired =
        mandate.durationType !== 'permanent'
        &&
        (currentStatus === 'active' || currentStatus === 'paused')
        && expiresAt !== null
        && Date.parse(expiresAt) <= now.getTime();

      if (expired) {
        const version = Number(mandate.version ?? 1);
        if (!Number.isSafeInteger(version) || version < 1) {
          throw new MandateError(500, 'INVALID_MANDATE', 'Mandate version is invalid.');
        }
        const nextVersion = version + 1;
        const timestamp = getServerTimestamp();
        transaction.update(mandateRef, {
          status: 'expired',
          version: nextVersion,
          updatedAt: timestamp,
        });
        transaction.create(mandateRef.collection('versions').doc(String(nextVersion).padStart(6, '0')), {
          version: nextVersion,
          createdBy: authentication.user.uid,
          createdAt: timestamp,
          reason: 'Mandate automatically expired on access.',
          snapshot: { ...mandate, status: 'expired', version: nextVersion, updatedAt: timestamp },
        });
        writeMandateAuditEvent(firestore, transaction, {
          mandateId,
          action: 'mandate.expired',
          performedBy: authentication.user.uid,
          payload: { previousStatus: currentStatus },
        });
        return true;
      }

      const nextStatus = {
        activate: 'active',
        pause: 'paused',
        resume: 'active',
        revoke: 'revoked',
        emergency_suspend: 'paused',
      }[parsed.data.action] as 'active' | 'paused' | 'revoked';

      const allowedTransition =
        (parsed.data.action === 'activate' && currentStatus === 'draft')
        || (parsed.data.action === 'pause' && currentStatus === 'active')
        || (parsed.data.action === 'resume' && currentStatus === 'paused')
        || (parsed.data.action === 'emergency_suspend' && currentStatus === 'active')
        || (
          parsed.data.action === 'revoke'
          && ['draft', 'active', 'paused'].includes(currentStatus)
        );
      if (!allowedTransition) {
        throw new MandateError(
          409,
          'INVALID_LIFECYCLE_TRANSITION',
          `Cannot ${parsed.data.action} a mandate in ${currentStatus} status.`,
        );
      }

      if (parsed.data.action === 'revoke') {
        const reservedAmountMinor = mandate.reservedAmountMinor ?? 0;
        const authorizationReservedAmountMinor = mandate.authorizationReservedAmountMinor ?? 0;
        if (
          typeof reservedAmountMinor !== 'number'
          || !Number.isSafeInteger(reservedAmountMinor)
          || reservedAmountMinor < 0
          || typeof authorizationReservedAmountMinor !== 'number'
          || !Number.isSafeInteger(authorizationReservedAmountMinor)
          || authorizationReservedAmountMinor < 0
        ) {
          throw new MandateError(500, 'INVALID_MANDATE', 'Mandate reservation data is invalid.');
        }
        if (reservedAmountMinor > 0 || authorizationReservedAmountMinor > 0) {
          throw new MandateError(
            409,
            'MANDATE_HAS_RESERVATIONS',
            'Mandate cannot be revoked while budget reservations remain.',
          );
        }
      }

      if (parsed.data.action === 'activate' || parsed.data.action === 'resume') {
        if (!startsAt || Date.parse(startsAt) > now.getTime()) {
          throw new MandateError(
            409,
            'MANDATE_NOT_STARTED',
            'Mandate cannot be activated before its start date.',
          );
        }
        if (
          mandate.durationType !== 'permanent'
          && (!expiresAt || Date.parse(expiresAt) <= now.getTime())
        ) {
          throw new MandateError(410, 'MANDATE_EXPIRED', 'Mandate has expired.');
        }
      }

      const version = Number(mandate.version ?? 1);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new MandateError(500, 'INVALID_MANDATE', 'Mandate version is invalid.');
      }
      const nextVersion = version + 1;
      const changes: Record<string, unknown> = {
        status: nextStatus,
        version: nextVersion,
        updatedAt: getServerTimestamp(),
        ...(parsed.data.action === 'resume' ? { emergencySuspension: null } : {}),
        ...(parsed.data.action === 'emergency_suspend'
          ? {
            emergencySuspension: {
              reason: parsed.data.reason,
              suspendedBy: authentication.user.uid,
              suspendedAt: getServerTimestamp(),
            },
          }
          : {}),
      };
      transaction.update(mandateRef, changes);
      transaction.create(mandateRef.collection('versions').doc(String(nextVersion).padStart(6, '0')), {
        version: nextVersion,
        createdBy: authentication.user.uid,
        createdAt: getServerTimestamp(),
        reason: parsed.data.action === 'emergency_suspend'
          ? parsed.data.reason
          : `Mandate ${parsed.data.action}.`,
        snapshot: {
          ...mandate,
          ...changes,
        },
      });
      writeMandateAuditEvent(firestore, transaction, {
        mandateId,
        action: `mandate.${parsed.data.action === 'activate'
          ? 'activated'
          : parsed.data.action === 'resume'
            ? 'resumed'
            : parsed.data.action === 'pause'
              ? 'paused'
              : parsed.data.action === 'emergency_suspend'
                ? 'emergency_suspended'
                : 'revoked'}`,
        performedBy: authentication.user.uid,
        payload: { previousStatus: currentStatus, status: nextStatus },
      });
      return false;
    });

    if (expired) {
      return apiError(410, 'MANDATE_EXPIRED', 'Mandate has expired.');
    }

    const updated = await mandateRef.get();
    const data = updated.data();
    if (!data) {
      throw new Error('Updated mandate document could not be read.');
    }
    return apiSuccess(formatMandate(updated.id, data));
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
