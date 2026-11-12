import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { negotiationStrategyProfileSchema } from '@/models/negotiation';

const defaultProfile = {
  posture: 'balanced',
  priorities: ['price', 'delivery', 'certainty'],
  concessionStepBasisPoints: 500,
} as const;

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }
  try {
    const snapshot = await adminFirestore.collection('negotiationStrategyProfiles')
      .doc(authentication.user.uid)
      .get();
    const storedProfile = snapshot.data();
    const profile = snapshot.exists && storedProfile
      ? negotiationStrategyProfileSchema.parse({
          posture: storedProfile.posture,
          priorities: storedProfile.priorities,
          concessionStepBasisPoints: storedProfile.concessionStepBasisPoints,
        })
      : defaultProfile;
    return apiSuccess(profile);
  } catch (error: unknown) {
    console.error('Failed to load negotiation strategy profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Negotiation strategy could not be loaded.');
  }
}

export async function PUT(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  const body: unknown = await request.json().catch(() => null);
  const parsed = negotiationStrategyProfileSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Negotiation strategy profile is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }
  try {
    await adminFirestore.collection('negotiationStrategyProfiles')
      .doc(authentication.user.uid)
      .set({
        ...parsed.data,
        ownerId: authentication.user.uid,
        updatedAt: new Date(),
      });
    return apiSuccess(parsed.data);
  } catch (error: unknown) {
    console.error('Failed to save negotiation strategy profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Negotiation strategy could not be saved.');
  }
}
