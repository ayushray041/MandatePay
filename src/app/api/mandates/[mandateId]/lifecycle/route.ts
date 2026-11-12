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
        (currentStatus === 'active' || currentStatus === 'paused')
        && expiresAt !== null
        && Date.parse(expiresAt) <= now.getTime();

      if (expired) {
        transaction.update(mandateRef, {
          status: 'expired',
          updatedAt: getServerTimestamp(),
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
      }[parsed.data.action] as 'active' | 'paused' | 'revoked';

      const allowedTransition =
        (parsed.data.action === 'activate' && currentStatus === 'draft')
        || (parsed.data.action === 'pause' && currentStatus === 'active')
        || (parsed.data.action === 'resume' && currentStatus === 'paused')
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
        if (
          typeof reservedAmountMinor !== 'number'
          || !Number.isSafeInteger(reservedAmountMinor)
          || reservedAmountMinor < 0
        ) {
          throw new MandateError(500, 'INVALID_MANDATE', 'Mandate reservation data is invalid.');
        }
        if (reservedAmountMinor > 0) {
          throw new MandateError(
            409,
            'MANDATE_HAS_RESERVATIONS',
            'Mandate cannot be revoked while accepted budget reservations remain.',
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
        if (!expiresAt || Date.parse(expiresAt) <= now.getTime()) {
          throw new MandateError(410, 'MANDATE_EXPIRED', 'Mandate has expired.');
        }
      }

      transaction.update(mandateRef, {
        status: nextStatus,
        updatedAt: getServerTimestamp(),
      });
      writeMandateAuditEvent(firestore, transaction, {
        mandateId,
        action: `mandate.${parsed.data.action === 'activate' ? 'activated' : parsed.data.action === 'resume' ? 'resumed' : parsed.data.action === 'pause' ? 'paused' : 'revoked'}`,
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
