'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { login, getIdToken } from '@/lib/firebase/auth-client';

const schema = z.object({
  email: z.string().email('Invalid email'),
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
      const token = await getIdToken(true);

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
        const payload = await response.json();
        throw new Error(payload.error || 'Authentication failed');
      }

      router.push('/dashboard');
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="max-w-md mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Log In</h1>
      {error && <p className="text-red-600">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="mt-1 p-2 block w-full border rounded"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="mt-1 p-2 block w-full border rounded"
            disabled={loading}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 text-white py-2 rounded hover:bg-emerald-700"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </section>
  );
}
