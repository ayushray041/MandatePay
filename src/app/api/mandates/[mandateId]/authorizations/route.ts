import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { isMandateApprover } from '@/lib/mandates/policy';
import { timestampToIso } from '@/lib/mandates/format';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { createMandateAuthorization } from '@/lib/mandates/authorization-service';
import { mandateAuthorizationRequestSchema } from '@/models/mandate';

type RouteContext = { params: Promise<{ mandateId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  try {
    const mandateSnapshot = await adminFirestore.collection('mandates').doc(mandateId).get();
    if (!mandateSnapshot.exists) {
      return apiError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }

    const mandate = mandateSnapshot.data();
    if (!mandate) {
      throw new Error('Mandate document has no data.');
    }
    if (
      mandate.ownerId !== authentication.user.uid
      && mandate.authorizedAgentId !== authentication.user.uid
      && !isMandateApprover(mandate, authentication.user.uid)
    ) {
      throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }

    const authorizations = await adminFirestore
      .collection('mandateAuthorizations')
      .where('mandateId', '==', mandateId)
      .orderBy('createdAt', 'desc')
      .get();

    return apiSuccess(authorizations.docs.map((snapshot) => {
      const data = snapshot.data();
      return {
        ...data,
        id: snapshot.id,
        createdAt: timestampToIso(data.createdAt),
        updatedAt: timestampToIso(data.updatedAt),
      };
    }));
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}

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

  const parsed = mandateAuthorizationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Mandate operation request is invalid.');
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  try {
    const result = await createMandateAuthorization(
      adminFirestore,
      mandateId,
      authentication.user.uid,
      parsed.data,
    );
    return apiSuccess(result, result.duplicate ? 200 : result.status === 'pending_approval' ? 202 : 201);
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
