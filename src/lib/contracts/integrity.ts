import { createHash, timingSafeEqual } from 'node:crypto';
import { ContractError } from '@/lib/contracts/errors';
import { contractTermsSchema } from '@/models/contract';

type VersionContent = {
  contractId: string;
  version: number;
  previousVersionId: string | null;
  negotiationId: string;
  amendmentId: string | null;
  createdBy: string;
  terms: unknown;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function contractVersionHash(content: VersionContent): string {
  const parsedTerms = contractTermsSchema.parse(content.terms);
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({ ...content, terms: parsedTerms })), 'utf8')
    .digest('hex');
}

export function contractVersionMetadata(content: VersionContent) {
  const integrityHash = contractVersionHash(content);
  return {
    integrityHash,
    documentMetadata: {
      format: 'mandatepay-contract-json-v1',
      contentType: 'application/json',
      fileName: `contract-${content.contractId}-v${content.version}.json`,
    },
  };
}

export function isContractVersionHashValid(
  content: VersionContent,
  storedHash: unknown,
): boolean {
  if (typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/.test(storedHash)) {
    return false;
  }
  const parsedTerms = contractTermsSchema.safeParse(content.terms);
  if (!parsedTerms.success) {
    return false;
  }
  const expected = Buffer.from(contractVersionHash({ ...content, terms: parsedTerms.data }), 'hex');
  const actual = Buffer.from(storedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function assertContractVersionIntegrity(
  content: VersionContent,
  storedHash: unknown,
  versionId: string,
): void {
  if (
    storedHash !== undefined
    && storedHash !== null
    && !isContractVersionHashValid(content, storedHash)
  ) {
    throw new ContractError(
      409,
      'CONTRACT_INTEGRITY_MISMATCH',
      `Contract version ${versionId} failed its integrity check.`,
    );
  }
}
