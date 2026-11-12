import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { ContractError, contractErrorResponse } from '@/lib/contracts/errors';
import { formatContractAmendment } from '@/lib/contracts/format';
import { assertRequiredApprover, contractExpiryStatus } from '@/lib/contracts/policy';
import { contractTermsSchema } from '@/models/contract';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Amendment storage is unavailable.');
  }

  const uid = authentication.user.uid;
  try {
    const snapshot = await adminFirestore.collectionGroup('amendments')
      .where('requiredApproverIds', 'array-contains', uid)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();
    const amendments = await Promise.all(snapshot.docs.map(async (amendmentSnapshot) => {
      const contractRef = amendmentSnapshot.ref.parent.parent;
      if (!contractRef) {
        throw new ContractError(500, 'INVALID_AMENDMENT', 'Amendment has no parent contract.');
      }
      const [contractSnapshot, baseVersionSnapshot] = await Promise.all([
        contractRef.get(),
        contractRef.collection('versions').doc(`v${amendmentSnapshot.get('baseVersion')}`).get(),
      ]);
      if (!contractSnapshot.exists || !baseVersionSnapshot.exists) {
        throw new ContractError(500, 'INVALID_AMENDMENT', 'Amendment contract version is unavailable.');
      }
      const contract = contractSnapshot.data();
      const baseVersion = baseVersionSnapshot.data();
      const amendment = amendmentSnapshot.data();
      if (!contract || !baseVersion || !amendment) {
        throw new ContractError(500, 'INVALID_AMENDMENT', 'Amendment data is incomplete.');
      }
      assertRequiredApprover(contract, uid);
      const baseTerms = contractTermsSchema.safeParse(baseVersion.terms);
      if (!baseTerms.success) {
        throw new ContractError(500, 'INVALID_AMENDMENT', 'Base contract terms are invalid.');
      }
      return {
        ...formatContractAmendment(amendmentSnapshot.id, amendment),
        contractStatus: contractExpiryStatus(contract.status, contract.expiresAt),
        contractVersion: Number(contract.currentVersion),
        contractTitle: baseTerms.data.service.title,
        baseTerms: baseTerms.data,
      };
    }));
    return apiSuccess(amendments);
  } catch (error: unknown) {
    return contractErrorResponse(error);
  }
}
