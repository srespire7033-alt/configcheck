'use client';

interface HealthScoreProps {
  score: number;
  size?: 'sm' | 'lg';
}

export function HealthScore({ score, size = 'lg' }: HealthScoreProps) {
  const getColor = () => {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  };

  const outerSize = size === 'lg' ? 'w-40 h-40' : 'w-20 h-20';
  const innerSize = size === 'lg' ? 'w-32 h-32' : 'w-16 h-16';
  const scoreText = size === 'lg' ? 'text-4xl' : 'text-xl';
  const subText = size === 'lg' ? 'text-sm' : 'text-[10px]';

  return (
    <div
      className={`${outerSize} rounded-full flex items-center justify-center`}
      style={{
        background: `conic-gradient(${getColor()} 0deg ${3.6 * score}deg, #e5e7eb ${3.6 * score}deg 360deg)`,
      }}
    >
      <div className={`${innerSize} bg-white rounded-full flex flex-col items-center justify-center`}>
        <span className={`${scoreText} font-bold text-gray-900`}>{score}</span>
        <span className={`${subText} text-gray-500`}>out of 100</span>
      </div>
    </div>
  );
}
