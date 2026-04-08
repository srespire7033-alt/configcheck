'use client';

import { getScoreColor } from '@/lib/utils';

interface HealthScoreProps {
  score: number;
  size?: 'sm' | 'lg';
}

export function HealthScore({ score, size = 'lg' }: HealthScoreProps) {
  const radius = size === 'lg' ? 70 : 40;
  const strokeWidth = size === 'lg' ? 10 : 6;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const svgSize = (radius + strokeWidth) * 2;

  const getGradientId = () => {
    if (score >= 80) return 'gradient-green';
    if (score >= 60) return 'gradient-yellow';
    return 'gradient-red';
  };

  return (
    <div className="relative flex flex-col items-center">
      <svg width={svgSize} height={svgSize} className="transform -rotate-90">
        <defs>
          <linearGradient id="gradient-green" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
          <linearGradient id="gradient-yellow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#ca8a04" />
          </linearGradient>
          <linearGradient id="gradient-red" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        {/* Background circle */}
        <circle
          cx={radius + strokeWidth}
          cy={radius + strokeWidth}
          r={radius}
          fill="none"
          stroke="#f3f4f6"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={radius + strokeWidth}
          cy={radius + strokeWidth}
          r={radius}
          fill="none"
          stroke={`url(#${getGradientId()})`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          filter="url(#glow)"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${size === 'lg' ? 'text-5xl' : 'text-2xl'} font-bold ${getScoreColor(score)}`}>
          {score}
        </span>
        <span className={`${size === 'lg' ? 'text-sm' : 'text-xs'} text-gray-400 font-medium`}>/100</span>
      </div>
    </div>
  );
}
