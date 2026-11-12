'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { firebaseApp } from '@/lib/firebase/client';

const protectedRoutes = [
  '/dashboard',
  '/projects',
  '/contracts',
  '/negotiations',
  '/amendments',
  '/payments',
  '/mandates',
];

function isProtectedRoute(pathname: string): boolean {
  return protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, error } = useAuth();
  const protectedPath = isProtectedRoute(pathname);

  useEffect(() => {
    if (protectedPath && !loading && !error && !user) {
      router.replace('/login');
    }
  }, [error, loading, protectedPath, router, user]);

  if (!protectedPath || (user && !loading)) {
    return <>{children}</>;
  }

  if (!firebaseApp) {
    return (
      <p className="mx-auto max-w-xl border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
        Sign-in is unavailable because Firebase client configuration is missing.
      </p>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl border-l-2 border-mp-orange bg-mp-surface px-4 py-3" role="alert">
        <p className="text-sm">{error}</p>
        <Link href="/login" className="mt-2 inline-block text-sm font-semibold underline">
          Return to sign in
        </Link>
      </div>
    );
  }

  return (
    <p className="py-12 text-center text-sm text-mp-medium-grey" role="status" aria-live="polite">
      {loading ? 'Checking your sign-in…' : 'Redirecting to sign in…'}
    </p>
  );
}
