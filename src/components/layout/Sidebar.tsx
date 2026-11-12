'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight,
  Bot,
  BriefcaseBusiness,
  FileCheck2,
  FileText,
  LayoutDashboard,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: BriefcaseBusiness },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/negotiations', label: 'Negotiations', icon: ArrowLeftRight },
  { href: '/amendments', label: 'Amendments', icon: FileCheck2 },
  { href: '/payments', label: 'Payments', icon: Wallet },
  { href: '/mandates', label: 'Mandates', icon: ShieldCheck },
  { href: '/agents', label: 'Agent Management', icon: Bot },
];

export const Sidebar: React.FC = () => {
  const pathname = usePathname();

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
