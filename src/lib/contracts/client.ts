'use client';

import { z } from 'zod';
import { authenticatedApiRequest } from '@/lib/api/client';
import {
  contractAmendmentSchema,
  contractEventSchema,
  contractRecordSchema,
  contractVersionSchema,
  type ContractRecord,
} from '@/models/contract';

const contractDetailSchema = z.object({
  contract: contractRecordSchema,
  versions: z.array(contractVersionSchema),
  amendments: z.array(contractAmendmentSchema),
  events: z.array(contractEventSchema),
}).strict();

export type ContractDetail = z.infer<typeof contractDetailSchema>;

export function listContracts(): Promise<ContractRecord[]> {
  return authenticatedApiRequest(
    '/api/contracts',
    z.array(contractRecordSchema),
    {},
    'Contracts could not be loaded.',
  );
}

export function getContract(contractId: string): Promise<ContractDetail> {
  return authenticatedApiRequest(
    `/api/contracts/${encodeURIComponent(contractId)}`,
    contractDetailSchema,
    {},
    'Contract details could not be loaded.',
  );
}

export function generateContract(negotiationId: string): Promise<ContractRecord> {
  return authenticatedApiRequest(
    '/api/contracts',
    contractRecordSchema,
    { method: 'POST', body: JSON.stringify({ negotiationId }) },
    'Contract could not be generated.',
  );
}

export function decideContract(
  contractId: string,
  input: { decision: 'approve' | 'reject'; reason?: string },
): Promise<ContractRecord> {
  return authenticatedApiRequest(
    `/api/contracts/${encodeURIComponent(contractId)}/approval`,
    contractRecordSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Contract review could not be recorded.',
  );
}
