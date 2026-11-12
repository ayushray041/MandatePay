import { apiError } from '@/lib/api/responses';

export class ContractError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContractError';
  }
}

export function contractErrorResponse(error: unknown): Response {
  if (error instanceof ContractError) {
    return apiError(error.status, error.code, error.message);
  }
  console.error('Contract operation failed.', error);
  return apiError(500, 'INTERNAL_ERROR', 'Contract operation could not be completed.');
}
