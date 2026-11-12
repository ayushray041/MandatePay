import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';

type RouteContext = { params: Promise<{ organizationId: string; memberUid: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Organization storage is unavailable.');
  }
  const { organizationId, memberUid } = await context.params;
  if (!/^[A-Za-z0-9_-]{20}$/.test(organizationId) || !memberUid || memberUid.includes('/')) {
    return apiError(404, 'ORGANIZATION_MEMBER_NOT_FOUND', 'Organization member was not found.');
  }
  if (memberUid === authentication.user.uid) {
    return apiError(409, 'OWNER_MEMBERSHIP_REQUIRED', 'The organization owner cannot remove their own membership.');
  }

  const firestore = adminFirestore;
  const organizationRef = firestore.collection('marketplaceOrganizations').doc(organizationId);
  const memberRef = organizationRef.collection('members').doc(memberUid);
  try {
    const removed = await firestore.runTransaction(async (transaction) => {
      const [organization, member] = await Promise.all([
        transaction.get(organizationRef),
        transaction.get(memberRef),
      ]);
      if (
        !organization.exists
        || organization.data()?.ownerId !== authentication.user.uid
        || !member.exists
        || member.data()?.role === 'owner'
      ) {
        return false;
      }
      transaction.delete(memberRef);
      transaction.update(organizationRef, { updatedAt: getServerTimestamp() });
      return true;
    });
    return removed
      ? apiSuccess({ uid: memberUid, status: 'removed' })
      : apiError(404, 'ORGANIZATION_MEMBER_NOT_FOUND', 'Organization member was not found.');
  } catch (error: unknown) {
    console.error('Failed to remove organization member.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Organization member could not be removed.');
  }
}
