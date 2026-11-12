import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { assertExecutionAllowed, assertOwner } from '@/lib/mandates/policy';
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
    await firestore.runTransaction(async (transaction) => {
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
      assertOwner(mandate, authentication.user.uid);
      if (authorization.status !== 'pending_approval') {
        throw new MandateError(409, 'AUTHORIZATION_NOT_PENDING', 'Operation authorization is not pending.');
      }

      if (parsed.data.decision === 'approve') {
        assertExecutionAllowed(
          mandate,
          authorization.operation,
          authorization.amountMinor,
          authorization.description,
          new Date(),
        );
        transaction.update(mandateRef, {
          spentAmountMinor: mandate.spentAmountMinor + authorization.amountMinor,
          updatedAt: getServerTimestamp(),
        });
      }

      transaction.update(authorizationRef, {
        status: parsed.data.decision === 'approve' ? 'approved' : 'rejected',
        updatedAt: getServerTimestamp(),
      });
      writeMandateAuditEvent(firestore, transaction, {
        mandateId,
        action: parsed.data.decision === 'approve'
          ? 'mandate.operation_approved'
          : 'mandate.operation_rejected',
        performedBy: authentication.user.uid,
        payload: {
          authorizationId,
          operation: authorization.operation,
          amountMinor: authorization.amountMinor,
        },
      });
    });

    const updated = await authorizationRef.get();
    const data = updated.data();
    if (!data) {
      throw new Error('Updated operation authorization could not be read.');
    }
    return apiSuccess({ id: updated.id, ...data });
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
