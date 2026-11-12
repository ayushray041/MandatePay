import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import {
  assertOwner,
  currentMandateVersion,
  isAuthorizedAgent,
  mandateStatus,
} from '@/lib/mandates/policy';
import { formatMandate, timestampToIso } from '@/lib/mandates/format';
import {
  mandateRenewalDecisionSchema,
  mandateRenewalRequestSchema,
} from '@/models/mandate';

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
  const parsed = mandateRenewalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Mandate renewal request is invalid.');
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
      if (!isAuthorizedAgent(mandate, authentication.user.uid)) {
        throw new MandateError(403, 'FORBIDDEN', 'Only the assigned agent can request renewal.');
      }
      const currentStatus = mandateStatus(mandate);
      const currentExpiry = timestampToIso(mandate.expiresAt);
      const requestedExpiry = Date.parse(parsed.data.requestedExpiresAt);
      if (
        mandate.durationType === 'permanent'
        || !currentExpiry
        || !['active', 'paused'].includes(currentStatus)
        || requestedExpiry <= Date.now()
        || requestedExpiry <= Date.parse(currentExpiry)
      ) {
        throw new MandateError(
          409,
          'RENEWAL_NOT_ALLOWED',
          'Only temporary active or paused mandates can be renewed to a later future expiry.',
        );
      }
      if (mandate.renewalRequest) {
        throw new MandateError(409, 'RENEWAL_ALREADY_PENDING', 'A renewal request is already pending.');
      }
      const now = getServerTimestamp();
      transaction.update(mandateRef, {
        renewalRequest: {
          requestedBy: authentication.user.uid,
          requestedExpiresAt: new Date(parsed.data.requestedExpiresAt),
          reason: parsed.data.reason,
          requestedAt: now,
        },
        updatedAt: now,
      });
      writeMandateAuditEvent(firestore, transaction, {
        mandateId,
        action: 'mandate.renewal_requested',
        performedBy: authentication.user.uid,
        payload: { requestedExpiresAt: parsed.data.requestedExpiresAt },
      });
    });

    const updated = await mandateRef.get();
    const data = updated.data();
    if (!data) {
      throw new Error('Renewal request could not be read.');
    }
    return apiSuccess(formatMandate(updated.id, data), 202);
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}

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
  const parsed = mandateRenewalDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Mandate renewal decision is invalid.');
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
      const renewal = mandate.renewalRequest;
      if (typeof renewal !== 'object' || renewal === null) {
        throw new MandateError(409, 'RENEWAL_NOT_PENDING', 'No renewal request is pending.');
      }

      const now = new Date();
      const nowTimestamp = getServerTimestamp();
      if (parsed.data.decision === 'reject') {
        transaction.update(mandateRef, {
          renewalRequest: null,
          updatedAt: nowTimestamp,
        });
        writeMandateAuditEvent(firestore, transaction, {
          mandateId,
          action: 'mandate.renewal_rejected',
          performedBy: authentication.user.uid,
          payload: { reason: parsed.data.reason },
        });
        return;
      }

      const requestedExpiry = timestampToIso(renewal.requestedExpiresAt);
      if (!requestedExpiry || Date.parse(requestedExpiry) <= now.getTime()) {
        throw new MandateError(409, 'RENEWAL_EXPIRED', 'Requested mandate expiry must still be in the future.');
      }
      const currentExpiry = timestampToIso(mandate.expiresAt);
      const alreadyExpired = !currentExpiry || Date.parse(currentExpiry) <= now.getTime();
      const version = currentMandateVersion(mandate);
      const nextVersion = version + 1;
      const changes: Record<string, unknown> = {
        expiresAt: new Date(requestedExpiry),
        durationType: 'temporary',
        renewalRequest: null,
        status: alreadyExpired ? 'active' : mandate.status,
        ...(alreadyExpired ? { startsAt: now } : {}),
        version: nextVersion,
        updatedAt: nowTimestamp,
      };
      transaction.update(mandateRef, changes);
      transaction.create(
        mandateRef.collection('versions').doc(String(nextVersion).padStart(6, '0')),
        {
          version: nextVersion,
          createdBy: authentication.user.uid,
          createdAt: nowTimestamp,
          reason: 'Mandate renewal approved.',
          snapshot: { ...mandate, ...changes },
        },
      );
      writeMandateAuditEvent(firestore, transaction, {
        mandateId,
        action: 'mandate.renewed',
        performedBy: authentication.user.uid,
        payload: { expiresAt: requestedExpiry, version: nextVersion },
      });
    });

    const updated = await mandateRef.get();
    const data = updated.data();
    if (!data) {
      throw new Error('Mandate renewal decision could not be read.');
    }
    return apiSuccess(formatMandate(updated.id, data));
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
