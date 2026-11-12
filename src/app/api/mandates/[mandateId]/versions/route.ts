import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { mandateErrorResponse, MandateError } from '@/lib/mandates/errors';
import { assertOwnerAgentOrApprover } from '@/lib/mandates/policy';
import { timestampToIso } from '@/lib/mandates/format';

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
    const mandate = mandateSnapshot.data();
    if (!mandateSnapshot.exists || !mandate) {
      throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }
    assertOwnerAgentOrApprover(mandate, authentication.user.uid);

    const versions = await adminFirestore
      .collection('mandates')
      .doc(mandateId)
      .collection('versions')
      .orderBy('version', 'desc')
      .limit(50)
      .get();
    return apiSuccess(versions.docs.map((snapshot) => {
      const version = snapshot.data();
      return {
        ...version,
        createdAt: timestampToIso(version.createdAt),
      };
    }));
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
