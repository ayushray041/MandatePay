import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { marketplaceOrganizationMemberSchema } from '@/models/marketplace';

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Organization storage is unavailable.');
  }
  const { organizationId } = await context.params;
  if (!/^[A-Za-z0-9_-]{20}$/.test(organizationId)) {
    return apiError(404, 'ORGANIZATION_NOT_FOUND', 'Organization was not found.');
  }

  const firestore = adminFirestore;
  try {
    const organizationRef = firestore.collection('marketplaceOrganizations').doc(organizationId);
    const organization = await organizationRef.get();
    if (!organization.exists || organization.data()?.ownerId !== authentication.user.uid) {
      return apiError(404, 'ORGANIZATION_NOT_FOUND', 'Organization was not found.');
    }
    const members = await organizationRef.collection('members').orderBy('createdAt', 'asc').limit(100).get();
    const data = await Promise.all(members.docs.map(async (member) => {
      const profile = await firestore.collection('users').doc(member.id).get();
      return {
        uid: member.id,
        displayName: profile.data()?.displayName ?? 'Account',
        role: member.data().role === 'owner' ? 'owner' : 'member',
        createdAt: member.data().createdAt instanceof Date
          ? member.data().createdAt.toISOString()
          : typeof member.data().createdAt?.toDate === 'function'
            ? member.data().createdAt.toDate().toISOString()
            : null,
      };
    }));
    return apiSuccess(data);
  } catch (error: unknown) {
    console.error('Failed to list organization members.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Organization members could not be loaded.');
  }
}

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Member request must be valid JSON.');
  }
  const parsed = marketplaceOrganizationMemberSchema.safeParse(body);
  if (!parsed.success || parsed.data.uid === authentication.user.uid) {
    return apiError(400, 'INVALID_ARGUMENT', 'A different existing account UID is required.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Organization storage is unavailable.');
  }
  const { organizationId } = await context.params;
  if (!/^[A-Za-z0-9_-]{20}$/.test(organizationId)) {
    return apiError(404, 'ORGANIZATION_NOT_FOUND', 'Organization was not found.');
  }

  const firestore = adminFirestore;
  const organizationRef = firestore.collection('marketplaceOrganizations').doc(organizationId);
  const userRef = firestore.collection('users').doc(parsed.data.uid);
  const memberRef = organizationRef.collection('members').doc(parsed.data.uid);
  const membersQuery = organizationRef.collection('members').limit(200);
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const [organization, user, member, members] = await Promise.all([
        transaction.get(organizationRef),
        transaction.get(userRef),
        transaction.get(memberRef),
        transaction.get(membersQuery),
      ]);
      if (!organization.exists || organization.data()?.ownerId !== authentication.user.uid) {
        return 'not_owner' as const;
      }
      if (!user.exists) {
        return 'user_not_found' as const;
      }
      if (member.exists) {
        return 'already_member' as const;
      }
      if (members.size >= 200) {
        return 'member_limit' as const;
      }
      transaction.create(memberRef, {
        uid: parsed.data.uid,
        role: 'member',
        createdAt: getServerTimestamp(),
      });
      return 'added' as const;
    });
    if (result === 'not_owner') {
      return apiError(404, 'ORGANIZATION_NOT_FOUND', 'Organization was not found.');
    }
    if (result === 'user_not_found') {
      return apiError(404, 'USER_NOT_FOUND', 'The target account was not found.');
    }
    if (result === 'already_member') {
      return apiError(409, 'ALREADY_MEMBER', 'The account is already a member.');
    }
    if (result === 'member_limit') {
      return apiError(409, 'ORGANIZATION_MEMBER_LIMIT', 'An organization can have at most 200 members.');
    }
    return apiSuccess({
      uid: parsed.data.uid,
      role: 'member',
      status: 'active',
    }, 201);
  } catch (error: unknown) {
    console.error('Failed to add organization member.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Organization member could not be added.');
  }
}
