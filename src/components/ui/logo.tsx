'use client';

import { ShieldCheck } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'white';
  showText?: boolean;
}

const sizes = {
  sm: { wrapper: 'w-8 h-8 rounded-lg', icon: 'h-4 w-4', text: 'text-base' },
  md: { wrapper: 'w-10 h-10 rounded-xl', icon: 'h-5 w-5', text: 'text-lg' },
  lg: { wrapper: 'w-12 h-12 rounded-xl', icon: 'h-7 w-7', text: 'text-2xl' },
};

export function Logo({ size = 'md', variant = 'default', showText = true }: LogoProps) {
  const s = sizes[size];

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${s.wrapper} flex items-center justify-center flex-shrink-0`}
        style={{ background: '#5B9BF3' }}
      >
        <ShieldCheck className={`${s.icon} text-white`} />
      </div>
      {showText && (
        <span
          className={`${s.text} font-bold ${
            variant === 'white' ? 'text-white' : 'text-gray-900 dark:text-white'
          }`}
        >
          ConfigCheck
        </span>
      )}
    </div>
  );
}
