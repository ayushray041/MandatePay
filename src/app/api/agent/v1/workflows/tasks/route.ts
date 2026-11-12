import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateAgentRequest } from '@/lib/agents/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { workflowErrorResponse } from '@/lib/workflows/policy';
import { listAgentTasks } from '@/lib/workflows/store';

export async function GET(request: Request) {
  const authentication = await authenticateAgentRequest(request, 'workflows:read');
  if (!authentication.authenticated) return authentication.response;
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Workflow storage is unavailable.');
  }
  try {
    return apiSuccess(await listAgentTasks(adminFirestore, authentication.agent));
  } catch (error: unknown) {
    return workflowErrorResponse(error);
  }
}
