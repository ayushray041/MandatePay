import { apiError } from '@/lib/api/responses';

export class NegotiationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NegotiationError';
  }
}

export function negotiationErrorResponse(error: unknown): Response {
  if (error instanceof NegotiationError) {
    return apiError(error.status, error.code, error.message);
  }

  console.error('Negotiation request failed.', error);
  return apiError(500, 'INTERNAL_ERROR', 'Negotiation request could not be completed.');
}
