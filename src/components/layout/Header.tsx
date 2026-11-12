'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { getAuthErrorMessage } from '@/lib/firebase/auth-errors';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/projects', label: 'Projects' },
  { href: '/contracts', label: 'Contracts' },
  { href: '/negotiations', label: 'Negotiations' },
  { href: '/amendments', label: 'Amendments' },
  { href: '/payments', label: 'Payments' },
];

export const Header: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
    } catch (error: unknown) {
      setLogoutError(getAuthErrorMessage(error, 'Unable to sign out.'));
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="relative z-20 border-b border-mp-warm-grey bg-mp-surface">
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-lg font-bold tracking-tight text-mp-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mp-orange"
        >
          <span aria-hidden="true" className="h-5 w-1.5 bg-mp-orange" />
          MandatePay
        </Link>

        <div className="hidden items-center gap-5 sm:flex">
          {user ? (
            <>
              <span className="max-w-48 truncate text-sm text-mp-medium-grey">
                {user.displayName || user.email}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="text-sm font-medium text-mp-medium-grey hover:text-mp-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange disabled:opacity-60"
              >
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-medium text-mp-medium-grey hover:text-mp-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex min-h-10 items-center justify-center bg-mp-orange px-4 text-sm font-semibold text-mp-ink transition-colors hover:bg-mp-app-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mp-orange"
              >
                Create account
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center text-mp-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mp-orange md:hidden"
          onClick={() => setOpen((isOpen) => !isOpen)}
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={open}
          aria-controls="mobile-primary-navigation"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <nav
        id="mobile-primary-navigation"
        aria-label="Primary navigation"
        hidden={!open}
        className="border-t border-mp-warm-grey bg-mp-surface px-4 pb-4 pt-2 md:hidden"
      >
          {links.map(({ href, label }) => {
            const isActive = pathname === href;

            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={`block border-l-2 px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange ${
                  isActive
                    ? 'border-mp-orange text-mp-ink'
                    : 'border-transparent text-mp-medium-grey hover:text-mp-ink'
                }`}
              >
                {label}
              </Link>
            );
          })}
          <div className="mt-3 flex gap-3 border-t border-mp-warm-grey pt-3 sm:hidden">
            {user ? (
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="px-3 py-2 text-sm font-medium disabled:opacity-60"
              >
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)} className="px-3 py-2 text-sm font-medium">
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setOpen(false)}
                  className="bg-mp-orange px-3 py-2 text-sm font-semibold text-mp-ink"
                >
                  Create account
                </Link>
              </>
            )}
          </div>
      </nav>
      {logoutError && (
        <p className="border-t border-mp-warm-grey px-4 py-2 text-sm text-mp-ink sm:text-right" role="alert">
          {logoutError}
        </p>
      )}
    </header>
  );
};
