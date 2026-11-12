import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { mandateErrorResponse, MandateError } from '@/lib/mandates/errors';
import { assertOwner } from '@/lib/mandates/policy';
import { formatMandate } from '@/lib/mandates/format';
import { mandateDuplicateSchema } from '@/models/mandate';

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
  const parsed = mandateDuplicateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Mandate duplication request is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  const firestore = adminFirestore;
  const sourceRef = firestore.collection('mandates').doc(mandateId);
  const duplicateRef = firestore.collection('mandates').doc();
  try {
    await firestore.runTransaction(async (transaction) => {
      const sourceSnapshot = await transaction.get(sourceRef);
      if (!sourceSnapshot.exists) {
        throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
      }
      const source = sourceSnapshot.data();
      if (!source) {
        throw new Error('Mandate document has no data.');
      }
      assertOwner(source, authentication.user.uid);

      const now = getServerTimestamp();
      const duplicate = {
        ...source,
        title: parsed.data.title ?? `${source.title} (copy)`,
        status: 'draft',
        spentAmountMinor: 0,
        reservedAmountMinor: 0,
        authorizationReservedAmountMinor: 0,
        velocityUsage: { totalTransactionCount: 0 },
        version: 1,
        emergencySuspension: null,
        renewalRequest: null,
        pendingLimitRequest: null,
        createdAt: now,
        updatedAt: now,
      };
      transaction.create(duplicateRef, duplicate);
      transaction.create(duplicateRef.collection('versions').doc('000001'), {
        version: 1,
        createdBy: authentication.user.uid,
        createdAt: now,
        reason: `Duplicated from mandate ${mandateId}.`,
        snapshot: duplicate,
      });
      writeMandateAuditEvent(firestore, transaction, {
        mandateId: duplicateRef.id,
        action: 'mandate.duplicated',
        performedBy: authentication.user.uid,
        payload: { sourceMandateId: mandateId },
      });
    });

    const duplicateSnapshot = await duplicateRef.get();
    const duplicate = duplicateSnapshot.data();
    if (!duplicate) {
      throw new Error('Duplicated mandate could not be read.');
    }
    return apiSuccess(formatMandate(duplicateSnapshot.id, duplicate), 201);
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
