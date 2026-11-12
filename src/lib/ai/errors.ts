import { apiError } from '@/lib/api/responses';
import { AiProviderError } from '@/lib/ai/provider';
import { z } from 'zod';

export class AiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

export function aiErrorResponse(error: unknown): Response {
  if (error instanceof AiRequestError) {
    return apiError(error.status, error.code, error.message);
  }
  if (error instanceof AiProviderError) {
    const status = error.code === 'AI_NOT_CONFIGURED'
      ? 503
      : error.code === 'AI_INVALID_OUTPUT'
        ? 502
        : 503;
    return apiError(status, error.code, error.message);
  }
  console.error(JSON.stringify({
    event: 'ai.request',
    outcome: 'failure',
    code: 'AI_INTERNAL_ERROR',
    errorName: error instanceof Error ? error.name : 'UnknownError',
    ...(error instanceof z.ZodError
      ? { validationPaths: error.issues.map((issue) => issue.path.join('.')) }
      : {}),
  }));
  return apiError(500, 'AI_INTERNAL_ERROR', 'AI intelligence could not be completed.');
}
