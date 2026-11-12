import { apiError, apiSuccess } from '@/lib/api/responses';
import { authenticateAgentRequest } from '@/lib/agents/auth';
import { ensureAgentRecord } from '@/lib/agents/store';

export async function GET(request: Request) {
  const authentication = await authenticateAgentRequest(request, 'agent:profile:read');
  if (!authentication.authenticated) {
    return authentication.response;
  }
  try {
    const profile = await ensureAgentRecord(authentication.agent.ownerId);
    if (!profile || profile.agentId !== authentication.agent.agentId) {
      return apiError(401, 'INVALID_AGENT_CREDENTIAL', 'Agent credentials are invalid or inactive.');
    }
    return apiSuccess(profile);
  } catch (error: unknown) {
    console.error('Agent could not load its profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Agent profile could not be loaded.');
  }
}
