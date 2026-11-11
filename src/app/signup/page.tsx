import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { register, getIdToken } from '@/lib/firebase/auth-client';
import { z } from 'zod';

const schema = z.object({
  fullName: z.string().min(1, 'Full name required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 chars'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = {
      fullName: String(formData.get('fullName') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      confirmPassword: String(formData.get('confirmPassword') ?? ''),
    };
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await register(parsed.data.email, parsed.data.password, parsed.data.fullName);
      const token = await getIdToken(true);
      if (!token) throw new Error('Failed to retrieve ID token');
      const resp = await fetch('/api/users/me', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayName: parsed.data.fullName }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Profile creation failed');
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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sign Up</h1>
      {error && <p className="text-red-600">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="fullName">Full Name</label>
          <input id="fullName" name="fullName" type="text" required className="mt-1 p-2 block w-full border rounded" disabled={loading} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className="mt-1 p-2 block w-full border rounded" disabled={loading} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required className="mt-1 p-2 block w-full border rounded" disabled={loading} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="confirmPassword">Confirm Password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" required className="mt-1 p-2 block w-full border rounded" disabled={loading} />
        </div>
        <button type="submit" disabled={loading} className="w-full bg-emerald-600 text-white py-2 rounded hover:bg-emerald-700">
          {loading ? 'Creating...' : 'Create Account'}
        </button>
      </form>
    </section>
  );
}
