import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { changeOwnedWorkflowStatus } from '@/lib/workflows/store';
import { workflowErrorResponse } from '@/lib/workflows/policy';
import { workflowActionSchema } from '@/models/workflow';

type RouteContext = { params: Promise<{ workflowId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) return authentication.response;
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Workflow storage is unavailable.');
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  const parsed = workflowActionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Workflow action is invalid.');
  }
  const { workflowId } = await context.params;
  try {
    return apiSuccess(await changeOwnedWorkflowStatus(
      adminFirestore,
      authentication.user.uid,
      workflowId,
      parsed.data.action,
    ));
  } catch (error: unknown) {
    return workflowErrorResponse(error);
  }
}
