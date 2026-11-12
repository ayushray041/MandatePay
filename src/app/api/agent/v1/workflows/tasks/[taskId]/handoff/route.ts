import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateAgentRequest } from '@/lib/agents/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { workflowErrorResponse } from '@/lib/workflows/policy';
import { handoffWorkflowTask } from '@/lib/workflows/store';
import { workflowTaskHandoffSchema } from '@/models/workflow';

type RouteContext = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateAgentRequest(request, 'workflows:delegate');
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
  const parsed = workflowTaskHandoffSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Task handoff is invalid.');
  }
  const { taskId } = await context.params;
  try {
    return apiSuccess(await handoffWorkflowTask(
      adminFirestore,
      authentication.agent,
      taskId,
      parsed.data.delegatedAgentId,
      parsed.data.expectedVersion,
      parsed.data.reason,
    ));
  } catch (error: unknown) {
    return workflowErrorResponse(error);
  }
}
