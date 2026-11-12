const authErrorMessages: Record<string, string> = {
  'auth/email-already-in-use': 'An account already exists for this email address.',
  'auth/invalid-credential': 'The email or password is incorrect.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/network-request-failed': 'Unable to reach Firebase. Check your connection and try again.',
  'auth/operation-not-allowed': 'Email and password sign-in is not enabled for this project.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/weak-password': 'Choose a stronger password.',
};

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string' && authErrorMessages[code]) {
      return authErrorMessages[code];
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
