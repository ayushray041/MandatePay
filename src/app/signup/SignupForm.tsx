'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { register, getIdToken } from '@/lib/firebase/auth-client';
import Link from 'next/link';
import { ArrowRight, FileCheck2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

const schema = z
  .object({
    fullName: z.string().min(1, 'Full name required'),
    email: z.string().email('Invalid email'),
    password: z.string().min(6, 'Password must be at least 6 chars'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      fullName: String(formData.get('fullName') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      confirmPassword: String(formData.get('confirmPassword') ?? ''),
    };

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await register(parsed.data.email, parsed.data.password, parsed.data.fullName);
      const token = await getIdToken(true);

      if (!token) {
        throw new Error('Failed to retrieve ID token');
      }

      const response = await fetch('/api/users/me', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayName: parsed.data.fullName }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Profile creation failed');
      }

      router.push('/dashboard');
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Profile creation failed');
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
            <FileCheck2 size={22} aria-hidden="true" />
          </div>
          <p className="mp-kicker text-mp-warm-grey">Start with agreement</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Set up your account.
          </h1>
          <p className="mt-4 max-w-sm leading-7 text-mp-app-bg">
            Bring the terms, people, and approvals that shape a working agreement into focus.
          </p>
        </div>
        <p className="text-sm text-mp-warm-grey">MandatePay · Agent-to-agent commerce</p>
      </div>

      <div className="p-6 sm:p-10">
        <div className="mb-8">
          <p className="mp-kicker">New account</p>
          <h2 className="mp-section-title mt-2">Create your account</h2>
          <p className="mp-copy mt-2">Add your details to get started.</p>
        </div>
        {error && (
          <p className="mb-5 border-l-2 border-mp-orange bg-mp-app-bg px-3 py-2 text-sm text-mp-ink" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mp-label" htmlFor="fullName">
              Full name
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              autoComplete="name"
              required
              className="mp-input mt-1"
              disabled={loading}
            />
          </div>
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
              autoComplete="new-password"
              required
              className="mp-input mt-1"
              disabled={loading}
            />
          </div>
          <div>
            <label className="mp-label" htmlFor="confirmPassword">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              className="mp-input mt-1"
              disabled={loading}
            />
          </div>
          <Button type="submit" disabled={loading} className="min-h-12 w-full">
            {loading ? 'Creating...' : 'Create account'} <ArrowRight size={17} aria-hidden="true" />
          </Button>
        </form>
        <p className="mt-7 border-t border-mp-warm-grey pt-5 text-sm text-mp-medium-grey">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-semibold text-mp-ink underline decoration-mp-orange decoration-2 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange"
          >
            Sign in
          </Link>
        </p>
      </div>
    </section>
  );
}
