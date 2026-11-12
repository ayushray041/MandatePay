import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeAgentActivity } from '@/lib/agents/audit';
import { marketplaceVerificationUpdateSchema } from '@/models/marketplace';

type RouteContext = { params: Promise<{ agentId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Verification decision must be valid JSON.');
  }
  const parsed = marketplaceVerificationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Verification decision is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace verification is unavailable.');
  }
  const { agentId } = await context.params;
  if (!/^agt_[A-Za-z0-9_-]{32}$/.test(agentId)) {
    return apiError(404, 'AGENT_NOT_FOUND', 'Marketplace agent was not found.');
  }

  const firestore = adminFirestore;
  const adminRef = firestore.collection('users').doc(authentication.user.uid);
  const identityRef = firestore.collection('agentIdentities').doc(agentId);
  const profileRef = firestore.collection('agentMarketplaceProfiles').doc(agentId);
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const [adminSnapshot, identitySnapshot, profileSnapshot] = await Promise.all([
        transaction.get(adminRef),
        transaction.get(identityRef),
        transaction.get(profileRef),
      ]);
      const identity = identitySnapshot.data();
      const profile = profileSnapshot.data();
      if (adminSnapshot.data()?.role !== 'admin') {
        return { error: 'forbidden' as const };
      }
      if (
        !identitySnapshot.exists
        || !profileSnapshot.exists
        || !identity
        || !profile
        || identity.agentId !== agentId
        || profile.agentId !== agentId
        || profile.ownerId !== identity.agentUid
      ) {
        return { error: 'not_found' as const };
      }
      const version = Number(profile.version);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error('Stored marketplace profile version is invalid.');
      }
      const now = getServerTimestamp();
      transaction.update(profileRef, {
        verificationStatus: parsed.data.status,
        verificationReason: parsed.data.reason,
        version: version + 1,
        updatedAt: now,
      });
      writeAgentActivity(firestore, transaction, {
        ownerId: String(identity.agentUid),
        agentId,
        actorId: authentication.user.uid,
        action: 'marketplace.agent.verification.updated',
        details: { status: parsed.data.status, reason: parsed.data.reason },
      });
      return { status: parsed.data.status, version: version + 1 };
    });
    if ('error' in result) {
      return result.error === 'forbidden'
        ? apiError(403, 'ADMIN_REQUIRED', 'Only platform administrators can verify agents.')
        : apiError(404, 'AGENT_NOT_FOUND', 'Marketplace agent was not found.');
    }
    return apiSuccess({ agentId, status: result.status, version: result.version });
  } catch (error: unknown) {
    console.error('Failed to update marketplace verification status.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Marketplace verification could not be updated.');
  }
}
