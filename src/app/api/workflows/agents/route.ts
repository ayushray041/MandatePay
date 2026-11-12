import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { timestampToIso } from '@/lib/mandates/format';
import { getMandateDelegationPolicy, workflowErrorResponse, WorkflowError } from '@/lib/workflows/policy';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) return authentication.response;
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Workflow storage is unavailable.');
  }
  const firestore = adminFirestore;
  const mandateId = new URL(request.url).searchParams.get('mandateId');
  if (!mandateId) {
    return apiError(400, 'INVALID_ARGUMENT', 'A mandate ID is required.');
  }

  try {
    const mandateSnapshot = await firestore.collection('mandates').doc(mandateId).get();
    const mandate = mandateSnapshot.data();
    if (!mandateSnapshot.exists || !mandate || mandate.ownerId !== authentication.user.uid) {
      return apiError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }
    if (
      mandate.status !== 'active'
      || (timestampToIso(mandate.startsAt) && Date.parse(timestampToIso(mandate.startsAt) ?? '') > Date.now())
      || (timestampToIso(mandate.expiresAt) && Date.parse(timestampToIso(mandate.expiresAt) ?? '') <= Date.now())
    ) {
      return apiError(409, 'MANDATE_UNAVAILABLE', 'Only a currently active mandate can start a workflow.');
    }
    const policy = getMandateDelegationPolicy(mandate);
    const delegatedAgentIds = policy.allowedDelegateAgentIds ?? [];
    const profiles = await Promise.all([
      firestore.collection('agents').doc(String(mandate.authorizedAgentId)).get(),
      ...delegatedAgentIds.map(async (agentId) => {
        const identity = await firestore.collection('agentIdentities').doc(agentId).get();
        const ownerId = identity.data()?.agentUid;
        if (!identity.exists || typeof ownerId !== 'string') return null;
        return firestore.collection('agents').doc(ownerId).get();
      }),
    ]);
    const authorizedProfile = profiles[0]?.data();
    if (
      !authorizedProfile
      || authorizedProfile.ownerId !== mandate.authorizedAgentId
      || authorizedProfile.status !== 'active'
      || typeof authorizedProfile.agentId !== 'string'
    ) {
      throw new WorkflowError(409, 'AGENT_UNAVAILABLE', 'The mandate’s authorized agent is unavailable.');
    }
    const agents: Array<{
      agentId: string;
      displayName: string;
      role: 'authorized' | 'delegated';
    }> = [{
      agentId: authorizedProfile.agentId,
      displayName: typeof authorizedProfile.displayName === 'string'
        ? authorizedProfile.displayName
        : 'Authorized agent',
      role: 'authorized' as const,
    }];
    for (let index = 0; index < delegatedAgentIds.length; index += 1) {
      const profile = profiles[index + 1]?.data();
      if (
        !profile
        || profile.agentId !== delegatedAgentIds[index]
        || profile.status !== 'active'
      ) continue;
      agents.push({
        agentId: delegatedAgentIds[index],
        displayName: typeof profile.displayName === 'string' ? profile.displayName : 'Delegated agent',
        role: 'delegated' as const,
      });
    }
    return apiSuccess(agents);
  } catch (error: unknown) {
    return workflowErrorResponse(error);
  }
}
