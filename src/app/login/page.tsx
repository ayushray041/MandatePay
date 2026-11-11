import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, getIdToken } from '@/lib/firebase/auth-client';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
});

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    };
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(parsed.data.email, parsed.data.password);
      const token = await getIdToken(true);
      if (!token) throw new Error('Failed to retrieve ID token');
      // Verify token by hitting GET profile – optional but ensures token works.
      const resp = await fetch('/api/users/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Authentication failed');
      }
      router.push('/dashboard');
    } catch (e: any) {
      setError(e.message);
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
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className="mt-1 p-2 block w-full border rounded" disabled={loading} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required className="mt-1 p-2 block w-full border rounded" disabled={loading} />
        </div>
        <button type="submit" disabled={loading} className="w-full bg-emerald-600 text-white py-2 rounded hover:bg-emerald-700">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </section>
  );
}
