import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { aiErrorResponse, AiRequestError } from '@/lib/ai/errors';
import { analyzeContractTerms } from '@/lib/ai/contract-analysis';
import { createAiProvider } from '@/lib/ai/gemini';
import { ContractError } from '@/lib/contracts/errors';
import { assertContractParty } from '@/lib/contracts/policy';
import { formatContract, formatContractVersion } from '@/lib/contracts/format';
import { contractRecordSchema, contractVersionSchema } from '@/models/contract';

type RouteContext = { params: Promise<{ contractId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Contract storage is unavailable.');
  }

  const { contractId } = await context.params;
  try {
    const contractRef = adminFirestore.collection('contracts').doc(contractId);
    const contractSnapshot = await contractRef.get();
    const rawContract = contractSnapshot.data();
    if (!contractSnapshot.exists || !rawContract) {
      return apiError(404, 'CONTRACT_NOT_FOUND', 'Contract was not found.');
    }
    assertContractParty(rawContract, authentication.user.uid);
    const contract = contractRecordSchema.parse(formatContract(contractSnapshot.id, rawContract));
    const versionSnapshot = await contractRef.collection('versions').doc(contract.currentVersionId).get();
    const rawVersion = versionSnapshot.data();
    if (!versionSnapshot.exists || !rawVersion) {
      throw new AiRequestError(409, 'CURRENT_VERSION_UNAVAILABLE', 'The current contract version is unavailable.');
    }
    const version = contractVersionSchema.parse(formatContractVersion(versionSnapshot.id, rawVersion));
    if (version.contractId !== contractId || version.version !== contract.currentVersion) {
      throw new AiRequestError(409, 'CURRENT_VERSION_MISMATCH', 'The current contract version could not be verified.');
    }

    return apiSuccess(await analyzeContractTerms(createAiProvider(), version.terms));
  } catch (error: unknown) {
    if (error instanceof ContractError) {
      return apiError(error.status, error.code, error.message);
    }
    return aiErrorResponse(error);
  }
}
