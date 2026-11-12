import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { marketplaceOrganizationCreateSchema } from '@/models/marketplace';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Organization storage is unavailable.');
  }

  const firestore = adminFirestore;
  try {
    const memberships = await firestore.collectionGroup('members')
      .where('uid', '==', authentication.user.uid)
      .limit(100)
      .get();
    const organizations = await Promise.all(memberships.docs.map(async (membership) => {
      const organizationId = membership.ref.parent.parent?.id;
      if (!organizationId) {
        return null;
      }
      const organization = await firestore.collection('marketplaceOrganizations')
        .doc(organizationId)
        .get();
      const data = organization.data();
      if (!organization.exists || !data || typeof data.name !== 'string') {
        return null;
      }
      return {
        organizationId,
        name: data.name,
        role: membership.data().role === 'owner' ? 'owner' as const : 'member' as const,
        createdAt: data.createdAt instanceof Date
          ? data.createdAt.toISOString()
          : typeof data.createdAt?.toDate === 'function'
            ? data.createdAt.toDate().toISOString()
            : null,
      };
    }));
    return apiSuccess(organizations.filter((organization) => organization !== null));
  } catch (error: unknown) {
    console.error('Failed to load marketplace organizations.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Organizations could not be loaded.');
  }
}

export async function POST(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Organization request must be valid JSON.');
  }
  const parsed = marketplaceOrganizationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Organization details are invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Organization storage is unavailable.');
  }

  const firestore = adminFirestore;
  const organizationRef = firestore.collection('marketplaceOrganizations').doc();
  const ownerId = authentication.user.uid;
  const memberRef = organizationRef.collection('members').doc(ownerId);
  try {
    const now = getServerTimestamp();
    await firestore.runTransaction(async (transaction) => {
      transaction.create(organizationRef, {
        name: parsed.data.name,
        ownerId,
        createdAt: now,
        updatedAt: now,
      });
      transaction.create(memberRef, {
        uid: ownerId,
        role: 'owner',
        createdAt: now,
      });
    });
    return apiSuccess({
      organizationId: organizationRef.id,
      name: parsed.data.name,
      role: 'owner',
      createdAt: new Date().toISOString(),
    }, 201);
  } catch (error: unknown) {
    console.error('Failed to create marketplace organization.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Organization could not be created.');
  }
}
