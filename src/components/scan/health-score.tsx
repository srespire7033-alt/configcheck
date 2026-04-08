'use client';

import { getScoreColor } from '@/lib/utils';

interface HealthScoreProps {
  score: number;
  size?: 'sm' | 'lg';
}

export function HealthScore({ score, size = 'lg' }: HealthScoreProps) {
  const radius = size === 'lg' ? 70 : 40;
  const strokeWidth = size === 'lg' ? 8 : 6;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const svgSize = (radius + strokeWidth) * 2;

  const strokeColor =
    score >= 80 ? '#16a34a' : score >= 60 ? '#ca8a04' : '#dc2626';

  return (
    <div className="flex flex-col items-center">
      <svg width={svgSize} height={svgSize} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={radius + strokeWidth}
          cy={radius + strokeWidth}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={radius + strokeWidth}
          cy={radius + strokeWidth}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className={`absolute flex flex-col items-center justify-center`} style={{
        width: svgSize,
        height: svgSize,
      }}>
        <span className={`${size === 'lg' ? 'text-4xl' : 'text-2xl'} font-bold ${getScoreColor(score)}`}>
          {score}
        </span>
        <span className="text-xs text-gray-400">/100</span>
      </div>
    </div>
  );
}
