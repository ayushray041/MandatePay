import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  children: React.ReactNode;
}

const buttonStyles: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-mp-orange text-mp-ink hover:bg-mp-ink hover:text-white focus-visible:outline-mp-orange',
  secondary:
    'bg-mp-ink text-white hover:bg-mp-medium-grey focus-visible:outline-mp-ink',
  outline:
    'border border-mp-warm-grey bg-mp-surface text-mp-ink hover:border-mp-ink focus-visible:outline-mp-orange',
  ghost:
    'bg-transparent text-mp-ink hover:bg-mp-app-bg focus-visible:outline-mp-orange',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  className = '',
  children,
  ...props
}) => (
  <button
    className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
    {...props}
  >
    {children}
  </button>
);
