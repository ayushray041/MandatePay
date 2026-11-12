import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getOwnedWorkflow } from '@/lib/workflows/store';
import { workflowErrorResponse } from '@/lib/workflows/policy';

type RouteContext = { params: Promise<{ workflowId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) return authentication.response;
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Workflow storage is unavailable.');
  }
  const { workflowId } = await context.params;
  try {
    return apiSuccess(await getOwnedWorkflow(adminFirestore, workflowId, authentication.user.uid));
  } catch (error: unknown) {
    return workflowErrorResponse(error);
  }
}
