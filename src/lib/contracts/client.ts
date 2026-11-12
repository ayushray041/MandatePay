'use client';

import { z } from 'zod';
import { authenticatedApiRequest } from '@/lib/api/client';
import {
  contractAmendmentSchema,
  contractEventSchema,
  contractRecordSchema,
  contractVersionSchema,
  amendmentDecisionSchema,
  amendmentProposeSchema,
  contractTermsSchema,
  type ContractRecord,
} from '@/models/contract';
import {
  contractAnalysisResponseSchema,
  type ContractAnalysisResponse,
} from '@/models/ai';

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

export function analyzeContract(contractId: string): Promise<ContractAnalysisResponse> {
  return authenticatedApiRequest(
    `/api/contracts/${encodeURIComponent(contractId)}/analysis`,
    contractAnalysisResponseSchema,
    { method: 'POST' },
    'Contract analysis could not be completed.',
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

export function proposeContractAmendment(
  contractId: string,
  input: z.infer<typeof amendmentProposeSchema>,
) {
  return authenticatedApiRequest(
    `/api/contracts/${encodeURIComponent(contractId)}/amendments`,
    contractAmendmentSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Amendment could not be proposed.',
  );
}

export function decideContractAmendment(
  contractId: string,
  amendmentId: string,
  input: z.infer<typeof amendmentDecisionSchema>,
) {
  return authenticatedApiRequest(
    `/api/contracts/${encodeURIComponent(contractId)}/amendments/${encodeURIComponent(amendmentId)}/decision`,
    contractAmendmentSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Amendment review could not be recorded.',
  );
}

const amendmentListItemSchema = contractAmendmentSchema.extend({
  contractStatus: z.string(),
  contractVersion: z.number().int().positive(),
  contractTitle: z.string(),
  baseTerms: contractTermsSchema,
});

export type AmendmentListItem = z.infer<typeof amendmentListItemSchema>;

export function listAmendments(): Promise<AmendmentListItem[]> {
  return authenticatedApiRequest(
    '/api/amendments',
    z.array(amendmentListItemSchema),
    {},
    'Amendments could not be loaded.',
  );
}
