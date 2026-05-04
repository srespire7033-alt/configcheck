'use client';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'white';
  showText?: boolean;
}

/**
 * OrgPrism brand mark — hollow hexagonal cube with four colored faces:
 *   purple (top-left), orange (top-right), sky (bottom-left), indigo (bottom-right).
 *
 * The thin gap-strokes between faces use stroke="currentColor" so the
 * gaps inherit from the parent's CSS color. To make the gaps "disappear"
 * into the surrounding background, set color: var(--bg) on a wrapping
 * element. We default to text-white for light theme and text-[#0b1120]
 * for the project's dark theme — same logic the dashboard uses.
 *
 * Inner hexagon is genuinely transparent (no fill), so any background
 * shows through — works on solid colors, gradients, images.
 */

const sizes = {
  sm: { wrapper: 'w-8 h-8', icon: 24, text: 'text-base' },
  md: { wrapper: 'w-10 h-10', icon: 32, text: 'text-lg' },
  lg: { wrapper: 'w-12 h-12', icon: 40, text: 'text-2xl' },
};

export function Logo({ size = 'md', variant = 'default', showText = true }: LogoProps) {
  const s = sizes[size];

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${s.wrapper} flex items-center justify-center flex-shrink-0 text-white dark:text-[#0b1120]`}
      >
        <LogoMark size={s.icon} />
      </div>
      {showText && (
        <span
          className={`${s.text} font-bold tracking-tight ${
            variant === 'white' ? 'text-white' : 'text-gray-900 dark:text-white'
          }`}
        >
          OrgPrism
        </span>
      )}
    </div>
  );
}

/**
 * Just the mark, no wordmark. Use this when you want the icon alone
 * (favicon, app tile, OAuth consent screen, etc). The caller controls
 * the gap color via parent CSS color.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      aria-label="OrgPrism logo"
    >
      <polygon
        points="32,4 8,18 20,25 32,18"
        fill="#A855F7"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <polygon
        points="32,4 32,18 44,25 56,18"
        fill="#F97316"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <polygon
        points="8,18 8,46 32,60 32,46 20,39 20,25"
        fill="#38BDF8"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <polygon
        points="56,18 44,25 44,39 32,46 32,60 56,46"
        fill="#1E40AF"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
