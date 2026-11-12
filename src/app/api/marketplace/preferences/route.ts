import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { marketplacePreferencesSchema } from '@/models/marketplace';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace preferences are unavailable.');
  }
  try {
    const snapshot = await adminFirestore.collection('marketplacePreferences')
      .doc(authentication.user.uid)
      .get();
    return apiSuccess({
      allowlistedAgentIds: snapshot.data()?.allowlistedAgentIds ?? [],
      blocklistedAgentIds: snapshot.data()?.blocklistedAgentIds ?? [],
    });
  } catch (error: unknown) {
    console.error('Failed to load marketplace preferences.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Marketplace preferences could not be loaded.');
  }
}

export async function PUT(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Marketplace preferences must be valid JSON.');
  }
  const parsed = marketplacePreferencesSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Marketplace allowlist/blocklist is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace preferences are unavailable.');
  }

  const firestore = adminFirestore;
  const ids = [...new Set([
    ...parsed.data.allowlistedAgentIds,
    ...parsed.data.blocklistedAgentIds,
  ])];
  try {
    const identities = await Promise.all(ids.map((agentId) => (
      firestore.collection('agentIdentities').doc(agentId).get()
    )));
    if (identities.some((identity) => !identity.exists)) {
      return apiError(400, 'INVALID_AGENT_ID', 'Each preference must reference a registered agent.');
    }
    const now = getServerTimestamp();
    await firestore.collection('marketplacePreferences')
      .doc(authentication.user.uid)
      .set({
        ...parsed.data,
        ownerUid: authentication.user.uid,
        updatedAt: now,
      }, { merge: true });
    return apiSuccess(parsed.data);
  } catch (error: unknown) {
    console.error('Failed to update marketplace preferences.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Marketplace preferences could not be updated.');
  }
}
