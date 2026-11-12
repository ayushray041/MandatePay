import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { assertNotExpired, assertOwner, mandateStatus } from '@/lib/mandates/policy';
import { mandateLimitDecisionSchema } from '@/models/mandate';

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

  const parsed = mandateLimitDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Spending-limit decision is invalid.');
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  const firestore = adminFirestore;
  const mandateRef = firestore.collection('mandates').doc(mandateId);
  try {
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(mandateRef);
      if (!snapshot.exists) {
        throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
      }

      const mandate = snapshot.data();
      if (!mandate) {
        throw new Error('Mandate document has no data.');
      }
      assertOwner(mandate, authentication.user.uid);

      const pending = mandate.pendingLimitRequest;
      if (typeof pending !== 'object' || pending === null) {
        throw new MandateError(409, 'NO_PENDING_LIMIT_REQUEST', 'No spending-limit request is pending.');
      }
      if (pending.previousLimitMinor !== mandate.spendingLimitMinor) {
        throw new MandateError(
          409,
          'STALE_LIMIT_REQUEST',
          'Mandate limit changed after this request; submit a new request.',
        );
      }

      if (parsed.data.decision === 'approve') {
        if (['revoked', 'expired'].includes(mandateStatus(mandate))) {
          throw new MandateError(
            409,
            'MANDATE_INACTIVE',
            'Spending-limit requests cannot be approved for inactive mandates.',
          );
        }
        assertNotExpired(mandate, new Date());
        const requestedLimitMinor = pending.requestedLimitMinor;
        if (typeof requestedLimitMinor !== 'number' || requestedLimitMinor <= mandate.spendingLimitMinor) {
          throw new MandateError(409, 'INVALID_LIMIT_REQUEST', 'Pending spending-limit request is invalid.');
        }
        if (
          mandate.executionConditions?.maximumOperationAmountMinor !== undefined
          && mandate.executionConditions.maximumOperationAmountMinor > requestedLimitMinor
        ) {
          throw new MandateError(
            409,
            'INVALID_LIMIT_REQUEST',
            'Requested limit is below the per-operation maximum.',
          );
        }

        transaction.update(mandateRef, {
          spendingLimitMinor: requestedLimitMinor,
          pendingLimitRequest: null,
          updatedAt: getServerTimestamp(),
        });
      } else {
        transaction.update(mandateRef, {
          pendingLimitRequest: null,
          updatedAt: getServerTimestamp(),
        });
      }

      writeMandateAuditEvent(firestore, transaction, {
        mandateId,
        action: parsed.data.decision === 'approve'
          ? 'mandate.limit_increase_approved'
          : 'mandate.limit_increase_rejected',
        performedBy: authentication.user.uid,
        payload: {
          previousLimitMinor: mandate.spendingLimitMinor,
          requestedLimitMinor: pending.requestedLimitMinor,
          requestedBy: pending.requestedBy,
        },
      });
    });

    const updated = await mandateRef.get();
    const data = updated.data();
    if (!data) {
      throw new Error('Updated mandate document could not be read.');
    }

    return apiSuccess({
      id: updated.id,
      spendingLimitMinor: data.spendingLimitMinor,
      pendingLimitRequest: data.pendingLimitRequest,
    });
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
