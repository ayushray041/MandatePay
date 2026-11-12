'use client';

import { z } from 'zod';
import { getApiErrorMessage } from '@/lib/api/client-errors';
import { getIdToken } from '@/lib/firebase/auth-client';
import {
  mandateAuthorizationRecordSchema,
  mandateRecordSchema,
  type MandateAuthorizationRecord,
  type MandateCreateInput,
  type MandateRecord,
} from '@/models/mandate';

async function mandateRequest<T extends z.ZodType>(
  path: string,
  dataSchema: T,
  init: RequestInit = {},
): Promise<z.infer<T>> {
  const token = await getIdToken();
  if (!token) {
    throw new Error('Your sign-in session has expired. Sign in again to continue.');
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
    throw new Error(await getApiErrorMessage(response, 'Mandate request failed.'));
  }

  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw new Error('Mandate API returned an invalid response.');
  }
  const parsed = dataSchema.safeParse(payload.data);
  if (!parsed.success) {
    throw new Error('Mandate API returned an invalid response.');
  }

  return parsed.data;
}

export async function listMandates(): Promise<MandateRecord[]> {
  return mandateRequest(
    '/api/mandates',
    z.array(mandateRecordSchema),
  );
}

export async function getMandate(mandateId: string): Promise<MandateRecord> {
  return mandateRequest(
    `/api/mandates/${encodeURIComponent(mandateId)}`,
    mandateRecordSchema,
  );
}

export async function createMandate(
  input: MandateCreateInput,
): Promise<MandateRecord> {
  return mandateRequest('/api/mandates', mandateRecordSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateMandate(
  mandateId: string,
  input: Partial<MandateCreateInput>,
): Promise<MandateRecord> {
  return mandateRequest(`/api/mandates/${encodeURIComponent(mandateId)}`, mandateRecordSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function performMandateAction(
  mandateId: string,
  action: 'activate' | 'pause' | 'resume' | 'revoke',
): Promise<MandateRecord> {
  return mandateRequest(
    `/api/mandates/${encodeURIComponent(mandateId)}/lifecycle`,
    mandateRecordSchema,
    {
      method: 'POST',
      body: JSON.stringify({ action }),
    },
  );
}

export async function requestMandateLimitIncrease(
  mandateId: string,
  requestedLimitMinor: number,
  reason: string,
): Promise<void> {
  await mandateRequest(
    `/api/mandates/${encodeURIComponent(mandateId)}/limit-requests`,
    z.object({
      pendingLimitRequest: z.object({ requestedLimitMinor: z.number() }),
    }),
    {
      method: 'POST',
      body: JSON.stringify({ requestedLimitMinor, reason }),
    },
  );
}

export async function decideMandateLimitIncrease(
  mandateId: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  await mandateRequest(
    `/api/mandates/${encodeURIComponent(mandateId)}/limit-requests/decision`,
    z.object({ id: z.string(), spendingLimitMinor: z.number() }),
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
    },
  );
}

export async function createMandateAuthorization(
  mandateId: string,
  request: { operation: string; amountMinor: number; description: string },
): Promise<void> {
  await mandateRequest(
    `/api/mandates/${encodeURIComponent(mandateId)}/authorizations`,
    z.object({
      authorization: mandateAuthorizationRecordSchema,
      status: z.enum(['pending_approval', 'approved']),
    }),
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  );
}

export async function listMandateAuthorizations(
  mandateId: string,
): Promise<MandateAuthorizationRecord[]> {
  return mandateRequest(
    `/api/mandates/${encodeURIComponent(mandateId)}/authorizations`,
    z.array(mandateAuthorizationRecordSchema),
  );
}

export async function decideMandateAuthorization(
  mandateId: string,
  authorizationId: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  await mandateRequest(
    `/api/mandates/${encodeURIComponent(mandateId)}/authorizations/${encodeURIComponent(authorizationId)}`,
    mandateAuthorizationRecordSchema,
    {
      method: 'PATCH',
      body: JSON.stringify({ decision }),
    },
  );
}
