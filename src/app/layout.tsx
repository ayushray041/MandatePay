import './globals.css';
import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { AuthProvider } from '@/components/providers/AuthProvider';

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
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
