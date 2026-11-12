import { adminFirestore } from '@/lib/firebase/admin';
import { getDocumentReference, getServerTimestamp } from '@/lib/firebase/firestore';
import { profileCreateSchema, profileUpdateSchema } from '@/models/user';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';

function validationDetails(issues: { path: PropertyKey[]; message: string }[]) {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }

  const { uid } = authentication.user;
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Profile storage is unavailable.');
  }

  try {
    const snapshot = await getDocumentReference('users', uid).get();
    if (!snapshot.exists) {
      return apiError(404, 'PROFILE_NOT_FOUND', 'User profile was not found.');
    }

    return apiSuccess(snapshot.data());
  } catch (error: unknown) {
    console.error('Failed to read Firebase user profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Profile could not be loaded.');
  }
}

export async function POST(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }

  const { uid, email } = authentication.user;
  if (!email) {
    return apiError(422, 'EMAIL_REQUIRED', 'A Firebase email address is required.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const parsed = profileCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      'INVALID_ARGUMENT',
      'Profile details are invalid.',
      validationDetails(parsed.error.issues),
    );
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Profile storage is unavailable.');
  }

  try {
    const userRef = getDocumentReference('users', uid);
    const snapshot = await userRef.get();
    if (snapshot.exists) {
      return apiError(409, 'PROFILE_ALREADY_EXISTS', 'User profile already exists.');
    }

    const data = {
      uid,
      email,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      createdAt: getServerTimestamp(),
      updatedAt: getServerTimestamp(),
    };

    await userRef.create(data);
    const createdProfile = await userRef.get();
    return apiSuccess(createdProfile.data(), 201);
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 6 || error.code === 'already-exists')
    ) {
      return apiError(409, 'PROFILE_ALREADY_EXISTS', 'User profile already exists.');
    }

    console.error('Failed to create Firebase user profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Profile could not be created.');
  }
}

export async function PATCH(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }

  const { uid } = authentication.user;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      'INVALID_ARGUMENT',
      'Profile update is invalid.',
      validationDetails(parsed.error.issues),
    );
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Profile storage is unavailable.');
  }

  try {
    const userRef = getDocumentReference('users', uid);
    const snapshot = await userRef.get();
    if (!snapshot.exists) {
      return apiError(404, 'PROFILE_NOT_FOUND', 'User profile was not found.');
    }

    await userRef.update({
      ...parsed.data,
      updatedAt: getServerTimestamp(),
    });

    const updatedSnapshot = await userRef.get();
    return apiSuccess(updatedSnapshot.data());
  } catch (error: unknown) {
    console.error('Failed to update Firebase user profile.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Profile could not be updated.');
  }
}
