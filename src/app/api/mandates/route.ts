import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { mandateCreateSchema } from '@/models/mandate';
import { formatMandate } from '@/lib/mandates/format';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { assertDelegatedAgentsRegistered } from '@/lib/mandates/delegation';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';

function validationDetails(issues: { path: PropertyKey[]; message: string }[]) {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { uid } = authentication.user;
  try {
    const [owned, assigned, awaitingApproval] = await Promise.all([
      adminFirestore
        .collection('mandates')
        .where('ownerId', '==', uid)
        .orderBy('createdAt', 'desc')
        .get(),
      adminFirestore
        .collection('mandates')
        .where('authorizedAgentId', '==', uid)
        .orderBy('createdAt', 'desc')
        .get(),
      adminFirestore
        .collection('mandates')
        .where('approvalRequirements.approverIds', 'array-contains', uid)
        .orderBy('createdAt', 'desc')
        .get(),
    ]);

    const mandates = new Map(
      [...owned.docs, ...assigned.docs, ...awaitingApproval.docs].map((snapshot) => [
        snapshot.id,
        formatMandate(snapshot.id, snapshot.data()),
      ]),
    );

    return apiSuccess(
      [...mandates.values()].sort((left, right) => {
        const leftCreated = Date.parse(String(left.createdAt ?? ''));
        const rightCreated = Date.parse(String(right.createdAt ?? ''));
        return rightCreated - leftCreated;
      }),
    );
  } catch (error: unknown) {
    console.error('Failed to list authorized mandates.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Mandates could not be loaded.');
  }
}

export async function POST(request: Request) {
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

  const parsed = mandateCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      'INVALID_ARGUMENT',
      'Mandate details are invalid.',
      validationDetails(parsed.error.issues),
    );
  }

  const { uid } = authentication.user;
  if (parsed.data.authorizedAgentId === uid) {
    return apiError(
      400,
      'INVALID_AGENT',
      'The authorized agent must be a different account from the owner.',
    );
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }
  const firestore = adminFirestore;

  try {
    const approvalRequirements = parsed.data.approvalRequirements;
    const approverIds = approvalRequirements.approverIds ?? [uid];
    if (!approverIds.includes(uid) || approverIds.includes(parsed.data.authorizedAgentId)) {
      return apiError(
        422,
        'INVALID_APPROVERS',
        'The mandate owner must be included in the approval policy and the authorized agent cannot approve their own operations.',
      );
    }

    const profileRefs = [
      parsed.data.authorizedAgentId,
      ...new Set(approverIds),
    ].map((userId) => firestore.collection('users').doc(userId));
    const profiles = await Promise.all(profileRefs.map((profileRef) => profileRef.get()));
    if (profiles.some((profile) => !profile.exists)) {
      return apiError(
        422,
        'INVALID_USER',
        'The authorized agent and every approver must have a registered user profile.',
      );
    }

    const mandateRef = firestore.collection('mandates').doc();
    const initialVersionRef = mandateRef.collection('versions').doc('000001');
    const now = getServerTimestamp();
    const mandate = {
      ownerId: uid,
      authorizedAgentId: parsed.data.authorizedAgentId,
      title: parsed.data.title,
      description: parsed.data.description,
      spendingLimitMinor: parsed.data.spendingLimitMinor,
      spentAmountMinor: 0,
      reservedAmountMinor: 0,
      authorizationReservedAmountMinor: 0,
      velocityUsage: { totalTransactionCount: 0 },
      currency: parsed.data.currency,
      durationType: parsed.data.durationType,
      startsAt: new Date(parsed.data.startsAt),
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      allowedOperations: parsed.data.allowedOperations,
      approvalRequirements: {
        ...approvalRequirements,
        approverIds,
      },
      executionConditions: parsed.data.executionConditions,
      status: 'draft',
      version: 1,
      emergencySuspension: null,
      renewalRequest: null,
      pendingLimitRequest: null,
      createdAt: now,
      updatedAt: now,
    };

    await firestore.runTransaction(async (transaction) => {
      await assertDelegatedAgentsRegistered(
        firestore,
        transaction,
        parsed.data.authorizedAgentId,
        parsed.data.executionConditions.allowedDelegateAgentIds ?? [],
      );
      transaction.create(mandateRef, mandate);
      transaction.create(initialVersionRef, {
        version: 1,
        createdBy: uid,
        createdAt: now,
        reason: 'Mandate created.',
        snapshot: mandate,
      });
      writeMandateAuditEvent(firestore, transaction, {
        mandateId: mandateRef.id,
        action: 'mandate.created',
        performedBy: uid,
        payload: {
          authorizedAgentId: parsed.data.authorizedAgentId,
          currency: parsed.data.currency,
          spendingLimitMinor: parsed.data.spendingLimitMinor,
          status: 'draft',
        },
      });
    });

    const createdSnapshot = await mandateRef.get();
    const createdData = createdSnapshot.data();
    if (!createdSnapshot.exists || !createdData) {
      throw new Error('Created mandate could not be read back from Firestore.');
    }

    return apiSuccess(formatMandate(mandateRef.id, createdData), 201);
  } catch (error: unknown) {
    if (error instanceof MandateError) {
      return mandateErrorResponse(error);
    }
    console.error('Failed to create mandate.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Mandate could not be created.');
  }
}
