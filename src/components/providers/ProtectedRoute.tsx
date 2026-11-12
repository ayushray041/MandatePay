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
  '/workflows',
  '/agents',
  '/marketplace',
];

function isProtectedRoute(pathname: string): boolean {
  return protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

function requiredRoleForRoute(pathname: string): 'client' | 'freelancer' | null {
  if (pathname === '/mandates/new') {
    return 'client';
  }
  if (pathname === '/agents' || pathname.startsWith('/agents/')) {
    return 'freelancer';
  }
  return null;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading, error } = useAuth();
  const protectedPath = isProtectedRoute(pathname);
  const requiredRole = requiredRoleForRoute(pathname);
  const roleDenied = Boolean(
    requiredRole
    && profile
    && profile.role !== 'admin'
    && profile.role !== requiredRole,
  );

  useEffect(() => {
    if (protectedPath && !loading && !error && !user) {
      router.replace('/login');
    }
  }, [error, loading, protectedPath, router, user]);

  if (!protectedPath) {
    return <>{children}</>;
  }

  if (user && profile && !loading && !error && !roleDenied) {
    return <>{children}</>;
  }

  if (!firebaseApp) {
    return (
      <p className="mx-auto max-w-xl border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
        Sign-in is unavailable because Firebase client configuration is missing.
      </p>
    );
  }

  if (roleDenied) {
    return (
      <div className="mx-auto max-w-xl border-l-2 border-mp-orange bg-mp-surface px-4 py-3" role="alert">
        <p className="text-sm">This page is not available to your account role.</p>
        <Link href="/dashboard" className="mt-2 inline-block text-sm font-semibold underline">
          Return to your dashboard
        </Link>
      </div>
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
      {loading ? 'Checking your sign-in and profile…' : 'Redirecting to sign in…'}
    </p>
  );
}
