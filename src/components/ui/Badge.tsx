import React from 'react';

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info';
  children: React.ReactNode;
}

const badgeStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  success: 'border-mp-orange bg-mp-surface text-mp-ink',
  warning: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
  danger: 'border-mp-ink bg-mp-ink text-white',
  info: 'border-mp-warm-grey bg-mp-surface text-mp-medium-grey',
};

export const Badge: React.FC<BadgeProps> = ({ variant = 'info', children }) => (
  <span
    className={`inline-flex items-center gap-2 border px-2 py-1 text-xs font-semibold ${badgeStyles[variant]}`}
  >
    {variant === 'success' ? <span className="h-1.5 w-1.5 bg-mp-orange" aria-hidden="true" /> : null}
    {children}
  </span>
);
