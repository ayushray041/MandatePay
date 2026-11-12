import { apiError } from '@/lib/api/responses';
import { verifyIdToken } from '@/lib/firebase/verify-token';

export type AuthenticatedUser = {
  uid: string;
  email?: string;
};

type AuthenticationResult =
  | { authenticated: true; user: AuthenticatedUser }
  | { authenticated: false; response: Response };

export async function authenticateRequest(
  request: Request,
): Promise<AuthenticationResult> {
  const verification = await verifyIdToken(
    request.headers.get('authorization'),
  );

  if (verification.success) {
    return {
      authenticated: true,
      user: {
        uid: verification.uid,
        email: verification.email,
      },
    };
  }

  if (verification.reason === 'unavailable') {
    return {
      authenticated: false,
      response: apiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Authentication service is unavailable.',
      ),
    };
  }

  return {
    authenticated: false,
    response: apiError(
      401,
      'UNAUTHENTICATED',
      'A valid Firebase bearer token is required.',
    ),
  };
}
