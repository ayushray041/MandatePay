'use client';

import { Suspense } from 'react';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { ProtectedRoute } from '@/components/providers/ProtectedRoute';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense
        fallback={
          <header className="relative z-20 min-h-16 border-b border-mp-warm-grey bg-mp-surface px-4 py-4 sm:px-6 lg:px-8">
            <span className="text-lg font-bold tracking-tight text-mp-ink">MandatePay</span>
          </header>
        }
      >
        <Header />
      </Suspense>

      <div className="flex min-h-0 flex-1">
        <Suspense
          fallback={
            <aside className="hidden w-60 shrink-0 border-r border-mp-warm-grey bg-mp-app-bg md:block" />
          }
        >
          <Sidebar />
        </Suspense>

        <main id="main-content" className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <Suspense
            fallback={
              <p className="py-12 text-center text-sm text-mp-medium-grey" role="status" aria-live="polite">
                Checking your sign-in…
              </p>
            }
          >
            <ProtectedRoute>{children}</ProtectedRoute>
          </Suspense>
        </main>
      </div>

      <Footer />
    </>
  );
}
