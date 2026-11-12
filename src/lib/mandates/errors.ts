import { apiError } from '@/lib/api/responses';

export class MandateError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MandateError';
  }
}

export function mandateErrorResponse(error: unknown): Response {
  if (error instanceof MandateError) {
    return apiError(error.status, error.code, error.message);
  }

  console.error('Mandate request failed.', error);
  return apiError(500, 'INTERNAL_ERROR', 'Mandate request could not be completed.');
}
