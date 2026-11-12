import './globals.css';
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
          <Header />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main id="main-content" className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
              <ProtectedRoute>{children}</ProtectedRoute>
            </main>
          </div>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
