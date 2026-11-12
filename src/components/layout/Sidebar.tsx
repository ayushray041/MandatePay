'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight,
  Bot,
  BriefcaseBusiness,
  FileCheck2,
  FileText,
  GitBranch,
  LayoutDashboard,
  ShieldCheck,
  Store,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';

const clientLinks = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/mandates', label: 'Mandates', icon: ShieldCheck },
  { href: '/negotiations', label: 'Negotiations', icon: ArrowLeftRight },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/amendments', label: 'Amendments', icon: FileCheck2 },
  { href: '/payments', label: 'Payments', icon: Wallet },
  { href: '/marketplace', label: 'Marketplace', icon: Store },
];

const freelancerLinks = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/negotiations', label: 'Work Requests & Proposals', icon: ArrowLeftRight },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/payments', label: 'Earnings & Payments', icon: Wallet },
  { href: '/mandates', label: 'My Mandates', icon: ShieldCheck },
  { href: '/marketplace', label: 'Service Directory', icon: Store },
  { href: '/agents', label: 'Agent Profile', icon: Bot },
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
];

const adminLinks = [
  ...clientLinks,
  { href: '/projects', label: 'Projects', icon: BriefcaseBusiness },
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
  { href: '/agents', label: 'Agent Management', icon: Bot },
];

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { profile } = useAuth();
  const links = profile?.role === 'client'
    ? clientLinks
    : profile?.role === 'freelancer'
      ? freelancerLinks
      : adminLinks;

  return (
    <aside className="hidden w-60 shrink-0 border-r border-mp-warm-grey bg-mp-app-bg md:flex md:flex-col">
      <nav aria-label="Primary navigation" className="flex-1 space-y-1 px-3 py-6">
        {links.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;

          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 border-l-2 px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange ${
                isActive
                  ? 'border-mp-orange bg-mp-surface text-mp-ink'
                  : 'border-transparent text-mp-medium-grey hover:bg-mp-surface hover:text-mp-ink'
              }`}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-mp-warm-grey px-5 py-4">
        <p className="text-xs font-medium text-mp-medium-grey">Negotiation, with intent.</p>
        <p className="mt-1 text-xs text-mp-medium-grey">MandatePay workspace</p>
      </div>
    </aside>
  );
};
