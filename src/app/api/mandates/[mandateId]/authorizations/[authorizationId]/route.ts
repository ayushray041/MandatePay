import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import {
  assertExecutionAllowed,
  currentMandateVersion,
  getMandateApprovalQuorum,
  getMandateApprovers,
  parseMandateUsageWindowKeys,
  releaseMandateVelocityUsage,
} from '@/lib/mandates/policy';
import { timestampToIso } from '@/lib/mandates/format';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { mandateLimitDecisionSchema } from '@/models/mandate';

type RouteContext = {
  params: Promise<{ mandateId: string; authorizationId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
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
    return apiError(400, 'INVALID_ARGUMENT', 'Authorization decision is invalid.');
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId, authorizationId } = await context.params;
  const firestore = adminFirestore;
  const mandateRef = firestore.collection('mandates').doc(mandateId);
  const authorizationRef = firestore.collection('mandateAuthorizations').doc(authorizationId);
  try {
    const outcome = await firestore.runTransaction(async (transaction) => {
      const [mandateSnapshot, authorizationSnapshot] = await Promise.all([
        transaction.get(mandateRef),
        transaction.get(authorizationRef),
      ]);
      if (!mandateSnapshot.exists || !authorizationSnapshot.exists) {
        throw new MandateError(404, 'AUTHORIZATION_NOT_FOUND', 'Operation authorization was not found.');
      }

      const mandate = mandateSnapshot.data();
      const authorization = authorizationSnapshot.data();
      if (!mandate || !authorization || authorization.mandateId !== mandateId) {
        throw new MandateError(404, 'AUTHORIZATION_NOT_FOUND', 'Operation authorization was not found.');
      }
      if (authorization.status !== 'pending_approval') {
        throw new MandateError(409, 'AUTHORIZATION_NOT_PENDING', 'Operation authorization is not pending.');
      }

      const approverIds = Array.isArray(authorization.approvalApproverIds)
        ? authorization.approvalApproverIds
        : getMandateApprovers(mandate);
      if (!approverIds.includes(authentication.user.uid)) {
        throw new MandateError(403, 'FORBIDDEN', 'You are not an approver for this operation.');
      }

      const currentApprovals = Array.isArray(authorization.approvals)
        ? authorization.approvals.filter((uid: unknown): uid is string => typeof uid === 'string')
        : [];
      if (currentApprovals.includes(authentication.user.uid)) {
        throw new MandateError(409, 'APPROVAL_ALREADY_RECORDED', 'Your decision has already been recorded.');
      }

      const nextApprovals = [...currentApprovals, authentication.user.uid];
      const now = new Date();
      const nowTimestamp = getServerTimestamp();
      const amountMinor = Number(authorization.amountMinor);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new MandateError(500, 'INVALID_AUTHORIZATION', 'Authorization amount is invalid.');
      }
      const reserved = Number(mandate.authorizationReservedAmountMinor ?? 0);
      if (!Number.isSafeInteger(reserved) || reserved < amountMinor) {
        throw new MandateError(500, 'INVALID_MANDATE', 'Authorization reservation data is invalid.');
      }
      const usageWindowKeys = parseMandateUsageWindowKeys(authorization.usageWindowKeys) ?? {};

      if (parsed.data.decision === 'reject') {
        const velocityUsage = releaseMandateVelocityUsage(mandate, amountMinor, usageWindowKeys);
        transaction.update(mandateRef, {
          authorizationReservedAmountMinor: reserved - amountMinor,
          velocityUsage,
          updatedAt: nowTimestamp,
        });
        transaction.update(authorizationRef, {
          status: 'rejected',
          approvals: nextApprovals,
          updatedAt: nowTimestamp,
        });
        writeMandateAuditEvent(firestore, transaction, {
          mandateId,
          action: 'mandate.operation_rejected',
          performedBy: authentication.user.uid,
          payload: { authorizationId, amountMinor },
        });
        return { status: 'rejected' as const };
      }

      const quorum = Number(
        authorization.approvalQuorum ?? getMandateApprovalQuorum(mandate),
      );
      if (!Number.isSafeInteger(quorum) || quorum < 1 || quorum > approverIds.length) {
        throw new MandateError(500, 'INVALID_AUTHORIZATION', 'Authorization quorum is invalid.');
      }
      if (nextApprovals.length < quorum) {
        transaction.update(authorizationRef, {
          approvals: nextApprovals,
          updatedAt: nowTimestamp,
        });
        writeMandateAuditEvent(firestore, transaction, {
          mandateId,
          action: 'mandate.operation_approval_recorded',
          performedBy: authentication.user.uid,
          payload: {
            authorizationId,
            approvalCount: nextApprovals.length,
            approvalQuorum: quorum,
          },
        });
        return { status: 'pending_approval' as const };
      }

      let rejectionReason: string | undefined;
      try {
        if (currentMandateVersion(mandate) !== authorization.mandateVersion) {
          throw new MandateError(
            409,
            'STALE_MANDATE_VERSION',
            'Mandate policy changed after this operation was requested.',
          );
        }
        assertExecutionAllowed(
          mandate,
          authorization.operation,
          amountMinor,
          authorization.description,
          now,
          {
            enforceVelocity: true,
            vendorId: typeof authorization.vendorId === 'string' ? authorization.vendorId : undefined,
            serviceCategory: typeof authorization.serviceCategory === 'string'
              ? authorization.serviceCategory
              : undefined,
            contractDurationDays: typeof authorization.contractDurationDays === 'number'
              ? authorization.contractDurationDays
              : undefined,
            excludeAuthorizationReservationMinor: amountMinor,
            excludeVelocityReservationAmountMinor: amountMinor,
            excludeVelocityUsageWindowKeys: usageWindowKeys,
          },
        );
      } catch (error: unknown) {
        if (!(error instanceof MandateError)) {
          throw error;
        }
        rejectionReason = error.message;
      }

      if (rejectionReason) {
        const velocityUsage = releaseMandateVelocityUsage(mandate, amountMinor, usageWindowKeys);
        transaction.update(mandateRef, {
          authorizationReservedAmountMinor: reserved - amountMinor,
          velocityUsage,
          updatedAt: nowTimestamp,
        });
        transaction.update(authorizationRef, {
          status: 'rejected',
          approvals: nextApprovals,
          rejectionReason,
          updatedAt: nowTimestamp,
        });
        writeMandateAuditEvent(firestore, transaction, {
          mandateId,
          action: 'mandate.operation_rejected',
          performedBy: authentication.user.uid,
          payload: { authorizationId, amountMinor, rejectionReason },
        });
        return { status: 'rejected' as const, failure: rejectionReason };
      }

      const spent = Number(mandate.spentAmountMinor);
      if (!Number.isSafeInteger(spent) || spent < 0 || !Number.isSafeInteger(spent + amountMinor)) {
        throw new MandateError(500, 'INVALID_MANDATE', 'Mandate spend data is invalid.');
      }
      transaction.update(mandateRef, {
        authorizationReservedAmountMinor: reserved - amountMinor,
        spentAmountMinor: spent + amountMinor,
        updatedAt: nowTimestamp,
      });
      transaction.update(authorizationRef, {
        status: 'approved',
        approvals: nextApprovals,
        updatedAt: nowTimestamp,
      });
      writeMandateAuditEvent(firestore, transaction, {
        mandateId,
        action: 'mandate.operation_approved',
        performedBy: authentication.user.uid,
        payload: {
          authorizationId,
          operation: authorization.operation,
          amountMinor,
          approvalCount: nextApprovals.length,
        },
      });
      return { status: 'approved' as const };
    });

    if (outcome.status === 'rejected' && outcome.failure) {
      return apiError(409, 'AUTHORIZATION_REJECTED', outcome.failure);
    }
    const updated = await authorizationRef.get();
    const data = updated.data();
    if (!data) {
      throw new Error('Updated operation authorization could not be read.');
    }
    return apiSuccess({
      id: updated.id,
      ...data,
      createdAt: timestampToIso(data.createdAt),
      updatedAt: timestampToIso(data.updatedAt),
    });
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
