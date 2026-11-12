'use client';

import { z } from 'zod';
import { getApiErrorMessage } from '@/lib/api/client-errors';
import { getCurrentUserToken } from '@/lib/firebase/auth-client';

export class ApiClientError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function authenticatedApiRequest<T extends z.ZodType>(
  path: string,
  dataSchema: T,
  init: RequestInit = {},
  fallbackMessage = 'API request failed.',
): Promise<z.infer<T>> {
  const token = await getCurrentUserToken(true);
  if (!token) {
    throw new ApiClientError('Your sign-in session has expired. Sign in again to continue.', 401);
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new ApiClientError(
      await getApiErrorMessage(response, fallbackMessage),
      response.status,
    );
  }

  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw new Error('API returned an invalid response.');
  }
  const parsed = dataSchema.safeParse(payload.data);
  if (!parsed.success) {
    throw new Error('API returned an invalid response.');
  }
  return parsed.data;
}
