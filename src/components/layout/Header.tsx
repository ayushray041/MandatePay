"use client";
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';

export const Header: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <header className="bg-gray-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between p-4">
        <Link href="/" className="text-xl font-semibold">
          MandatePay
        </Link>
        <nav className="hidden md:flex space-x-4">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/projects">Projects</NavLink>
          <NavLink href="/contracts">Contracts</NavLink>
          <NavLink href="/negotiations">Negotiations</NavLink>
          <NavLink href="/amendments">Amendments</NavLink>
          <NavLink href="/payments">Payments</NavLink>
        </nav>
        <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="menu">
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>
      {open && (
        <nav className="md:hidden bg-gray-700 px-4 pb-4 space-y-2">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/projects">Projects</NavLink>
          <NavLink href="/contracts">Contracts</NavLink>
          <NavLink href="/negotiations">Negotiations</NavLink>
          <NavLink href="/amendments">Amendments</NavLink>
          <NavLink href="/payments">Payments</NavLink>
        </nav>
      )}
    </header>
  );
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block py-1 hover:underline underline-offset-2">
      {children}
    </Link>
  );
}
