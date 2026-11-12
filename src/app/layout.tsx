import './globals.css';
import { Suspense } from 'react';
import { AuthProvider } from '@/components/providers/AuthProvider';
import type { Metadata } from 'next';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Sidebar } from '@/components/layout/Sidebar';
import { ProtectedRoute } from '@/components/providers/ProtectedRoute';

export const metadata: Metadata = {
  title: 'MandatePay',
  description: 'Negotiate the change. Protect the agreement. Pay for the work.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="min-h-full">
      <body className="flex min-h-dvh flex-col bg-mp-app-bg text-mp-ink">
        <a className="mp-skip-link" href="#main-content">
          Skip to main content
        </a>
        <AuthProvider>
          <Suspense fallback={(
            <header className="relative z-20 min-h-16 border-b border-mp-warm-grey bg-mp-surface px-4 py-4 sm:px-6 lg:px-8">
              <span className="text-lg font-bold tracking-tight text-mp-ink">MandatePay</span>
            </header>
          )}>
            <Header />
          </Suspense>
          <div className="flex min-h-0 flex-1">
            <Suspense fallback={<aside className="hidden w-60 shrink-0 border-r border-mp-warm-grey bg-mp-app-bg md:block" />}>
              <Sidebar />
            </Suspense>
            <main id="main-content" className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
              <Suspense fallback={(
                <p className="py-12 text-center text-sm text-mp-medium-grey" role="status" aria-live="polite">
                  Checking your sign-in…
                </p>
              )}>
                <ProtectedRoute>{children}</ProtectedRoute>
              </Suspense>
            </main>
          </div>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
