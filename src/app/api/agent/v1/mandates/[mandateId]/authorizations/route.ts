import { adminFirestore } from '@/lib/firebase/admin';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { authenticateAgentRequest } from '@/lib/agents/auth';
import { timestampToIso } from '@/lib/mandates/format';
import { mandateErrorResponse, MandateError } from '@/lib/mandates/errors';
import { createMandateAuthorization } from '@/lib/mandates/authorization-service';
import { mandateAuthorizationRequestSchema } from '@/models/mandate';

type RouteContext = { params: Promise<{ mandateId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateAgentRequest(request, 'mandates:read');
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  try {
    const mandateSnapshot = await adminFirestore.collection('mandates').doc(mandateId).get();
    const mandate = mandateSnapshot.data();
    if (!mandateSnapshot.exists || !mandate) {
      return apiError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }
    if (mandate.authorizedAgentId !== authentication.agent.uid) {
      throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }
    const authorizations = await adminFirestore.collection('mandateAuthorizations')
      .where('mandateId', '==', mandateId)
      .where('authorizedAgentId', '==', authentication.agent.uid)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    return apiSuccess(authorizations.docs.map((snapshot) => {
      const data = snapshot.data();
      return {
        id: snapshot.id,
        mandateId: data.mandateId,
        operation: data.operation,
        amountMinor: data.amountMinor,
        currency: data.currency,
        description: data.description,
        mandateVersion: data.mandateVersion,
        status: data.status,
        createdAt: timestampToIso(data.createdAt),
        updatedAt: timestampToIso(data.updatedAt),
      };
    }));
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateAgentRequest(request, 'mandates:authorize');
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
      authentication.agent.uid,
      parsed.data,
    );
    return apiSuccess(result, result.duplicate ? 200 : result.status === 'pending_approval' ? 202 : 201);
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
