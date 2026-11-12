import { apiError } from '@/lib/api/responses';

export class PaymentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export function paymentErrorResponse(error: unknown): Response {
  if (error instanceof PaymentError) {
    return apiError(error.status, error.code, error.message);
  }
  console.error('Payment operation failed.', error);
  return apiError(500, 'INTERNAL_ERROR', 'Payment operation could not be completed.');
}
