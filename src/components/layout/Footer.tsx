import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/projects', label: 'Projects' },
  { href: '/contracts', label: 'Contracts' },
  { href: '/payments', label: 'Payments' },
];

export const Footer: React.FC = () => (
  <footer className="border-t border-mp-warm-grey bg-mp-surface px-4 py-5 sm:px-6 lg:px-8">
    <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-mp-medium-grey">© 2026 MandatePay</p>
      <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-2">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="text-sm text-mp-medium-grey underline-offset-4 hover:text-mp-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange"
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  </footer>
);
