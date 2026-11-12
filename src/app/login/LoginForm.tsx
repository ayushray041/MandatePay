'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { login, getCurrentUser } from '@/lib/firebase/auth-client';
import Link from 'next/link';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getAuthErrorMessage } from '@/lib/firebase/auth-errors';
import { getApiErrorMessage } from '@/lib/api/client-errors';

const schema = z.object({
  email: z.string().trim().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
});

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    };

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await login(parsed.data.email, parsed.data.password);
      const currentUser = getCurrentUser();
      const token = currentUser ? await currentUser.getIdToken(true) : null;

      if (!token) {
        throw new Error('Failed to retrieve ID token');
      }

      const response = await fetch('/api/users/me', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Authentication failed'),
        );
      }

      router.push('/dashboard');
    } catch (caughtError: unknown) {
      setError(getAuthErrorMessage(caughtError, 'Authentication failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto grid w-full max-w-5xl border border-mp-warm-grey bg-mp-surface md:grid-cols-[0.9fr_1.1fr]">
      <div className="flex flex-col justify-between bg-mp-ink p-7 text-white sm:p-10">
        <Link href="/" className="text-sm font-semibold text-white hover:text-mp-app-bg">
          MandatePay
        </Link>
        <div className="my-12">
          <div className="mb-6 inline-flex border border-mp-medium-grey p-3 text-mp-orange">
            <LockKeyhole size={22} aria-hidden="true" />
          </div>
          <p className="mp-kicker text-mp-warm-grey">Workspace access</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Welcome back.</h1>
          <p className="mt-4 max-w-sm leading-7 text-mp-app-bg">
            Sign in to continue to your agreements, negotiations, and payment workspace.
          </p>
        </div>
        <p className="text-sm text-mp-warm-grey">MandatePay · Agent-to-agent commerce</p>
      </div>

      <div className="p-6 sm:p-10">
        <div className="mb-8">
          <p className="mp-kicker">Account</p>
          <h2 className="mp-section-title mt-2">Sign in</h2>
          <p className="mp-copy mt-2">Enter the email and password associated with your account.</p>
        </div>
        {error && (
          <p className="mb-5 border-l-2 border-mp-orange bg-mp-app-bg px-3 py-2 text-sm text-mp-ink" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mp-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mp-input mt-1"
              disabled={loading}
            />
          </div>
          <div>
            <label className="mp-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mp-input mt-1"
              disabled={loading}
            />
          </div>
          <Button type="submit" disabled={loading} className="min-h-12 w-full">
            {loading ? 'Signing in...' : 'Sign in'} <ArrowRight size={17} aria-hidden="true" />
          </Button>
        </form>
        <p className="mt-7 border-t border-mp-warm-grey pt-5 text-sm text-mp-medium-grey">
          New to MandatePay?{' '}
          <Link
            href="/signup"
            className="font-semibold text-mp-ink underline decoration-mp-orange decoration-2 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange"
          >
            Create an account
          </Link>
        </p>
      </div>
    </section>
  );
}
