// src/components/layout/Sidebar.tsx
"use client";
import Link from 'next/link';
import { X, Menu } from 'lucide-react';
import { useState } from 'react';

export const Sidebar: React.FC = () => {
  const [open, setOpen] = useState(false);
  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/projects', label: 'Projects' },
    { href: '/contracts', label: 'Contracts' },
    { href: '/negotiations', label: 'Negotiations' },
    { href: '/amendments', label: 'Amendments' },
    { href: '/payments', label: 'Payments' },
  ];
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-64 bg-[#001F3F] text-white flex flex-col p-4">
        <h2 className="text-xl font-bold mb-6">MandatePay</h2>
        <nav className="flex-1 space-y-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block py-2 px-3 rounded hover:bg-[#003366]"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </aside>
      {/* Mobile overlay */}
      <button
        className="md:hidden p-2 text-white bg-[#001F3F]"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <Menu size={24} />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 bg-black bg-opacity-50" onClick={() => setOpen(false)}>
          <aside
            className="w-64 h-full bg-[#001F3F] text-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="mb-4" onClick={() => setOpen(false)} aria-label="Close menu">
              <X size={24} />
            </button>
            <nav className="space-y-2">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="block py-2 px-3 rounded hover:bg-[#003366]"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
};
