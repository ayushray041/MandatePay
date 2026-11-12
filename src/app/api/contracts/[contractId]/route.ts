import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { ContractError, contractErrorResponse } from '@/lib/contracts/errors';
import {
  formatContract,
  formatContractAmendment,
  formatContractEvent,
  formatContractVersion,
} from '@/lib/contracts/format';
import { assertContractParty, contractExpiryStatus } from '@/lib/contracts/policy';
import { expireContractIfDue } from '@/lib/contracts/lifecycle';
import { assertContractVersionIntegrity } from '@/lib/contracts/integrity';
import { contractRecordSchema, contractVersionSchema } from '@/models/contract';

type RouteContext = { params: Promise<{ contractId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Contract storage is unavailable.');
  }

  const { contractId } = await context.params;
  const contractRef = adminFirestore.collection('contracts').doc(contractId);
  try {
    const snapshot = await contractRef.get();
    if (!snapshot.exists) {
      return apiError(404, 'CONTRACT_NOT_FOUND', 'Contract was not found.');
    }
    const data = snapshot.data();
    if (!data) {
      throw new Error('Contract document has no data.');
    }
    assertContractParty(data, authentication.user.uid);
    const now = new Date();
    const lifecycle = contractExpiryStatus(data.status, data.expiresAt, now) === 'expired'
      && data.status !== 'expired'
      ? await expireContractIfDue(adminFirestore, contractRef, now, 'access')
      : { data };
    const contractData = lifecycle.data;
    const contract = contractRecordSchema.parse(formatContract(snapshot.id, contractData));
    const [versions, amendments, events] = await Promise.all([
      contractRef.collection('versions').orderBy('version', 'asc').get(),
      contractRef.collection('amendments').orderBy('createdAt', 'asc').get(),
      contractRef.collection('events').orderBy('sequence', 'asc').get(),
    ]);

    return apiSuccess({
      contract,
      versions: versions.docs.map((version) => {
        const rawVersion = version.data();
        const hasHash = rawVersion.integrityHash !== undefined && rawVersion.integrityHash !== null;
        assertContractVersionIntegrity({
          contractId: String(rawVersion.contractId ?? ''),
          version: Number(rawVersion.version),
          previousVersionId: typeof rawVersion.previousVersionId === 'string'
            ? rawVersion.previousVersionId
            : null,
          negotiationId: String(rawVersion.negotiationId ?? ''),
          amendmentId: typeof rawVersion.amendmentId === 'string' ? rawVersion.amendmentId : null,
          createdBy: String(rawVersion.createdBy ?? ''),
          terms: rawVersion.terms,
        }, rawVersion.integrityHash, version.id);
        return contractVersionSchema.parse({
          ...formatContractVersion(version.id, rawVersion),
          integrityHash: hasHash ? rawVersion.integrityHash : null,
          integrityStatus: hasHash ? 'verified' : 'legacy_unhashed',
        });
      }),
      amendments: amendments.docs.map((amendment) => (
        formatContractAmendment(amendment.id, amendment.data())
      )),
      events: events.docs.map((event) => formatContractEvent(event.id, event.data())),
    });
  } catch (error: unknown) {
    if (error instanceof ContractError) {
      return contractErrorResponse(error);
    }
    console.error('Failed to load contract details.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Contract details could not be loaded.');
  }
}
