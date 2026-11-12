import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { createWorkflow, listOwnedWorkflows } from '@/lib/workflows/store';
import { workflowErrorResponse } from '@/lib/workflows/policy';
import { workflowCreateSchema } from '@/models/workflow';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) return authentication.response;
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Workflow storage is unavailable.');
  }

  try {
    return apiSuccess(await listOwnedWorkflows(adminFirestore, authentication.user.uid));
  } catch (error: unknown) {
    return workflowErrorResponse(error);
  }
}

export async function POST(request: Request) {
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
  const parsed = workflowCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      'INVALID_ARGUMENT',
      'Workflow details or task graph are invalid.',
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }

  try {
    const id = await createWorkflow(adminFirestore, authentication.user.uid, parsed.data);
    return apiSuccess({ id }, 201);
  } catch (error: unknown) {
    return workflowErrorResponse(error);
  }
}
