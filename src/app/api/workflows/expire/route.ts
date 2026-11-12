import { timingSafeEqual } from 'node:crypto';
import { adminFirestore } from '@/lib/firebase/admin';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { expireDueWorkflowTasks } from '@/lib/workflows/store';

function isAuthorized(request: Request, secret: string): boolean {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return apiError(503, 'SCHEDULER_NOT_CONFIGURED', 'Workflow timeout processing is not configured.');
  }
  if (!isAuthorized(request, secret)) {
    return apiError(401, 'UNAUTHORIZED', 'A valid scheduler credential is required.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Workflow storage is unavailable.');
  }
  try {
    return apiSuccess(await expireDueWorkflowTasks(adminFirestore));
  } catch (error: unknown) {
    console.error('Scheduled workflow timeout processing failed.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Workflow timeouts could not be processed.');
  }
}
