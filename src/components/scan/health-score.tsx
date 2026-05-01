'use client';

interface HealthScoreProps {
  score: number;
  size?: 'sm' | 'lg';
}

/**
 * 5-band colour scheme. The previous 3-band scheme (80+/60-79/<60) made
 * everything look green for scores ≥ 80, hiding the meaningful gap
 * between "very healthy" (90+) and "passable but flawed" (75-89).
 * Aligned with the recalibrated overall score: a clean org with no
 * criticals lands in the 90+ green band; 20+ criticals lands in the
 * red band.
 */
function getBand(score: number): { color: string; label: string; grade: string } {
  if (score >= 90) return { color: '#16a34a', label: 'Healthy', grade: 'A' };       // green
  if (score >= 75) return { color: '#84cc16', label: 'Passable', grade: 'B' };       // yellow-green
  if (score >= 60) return { color: '#f59e0b', label: 'Needs work', grade: 'C' };     // amber
  if (score >= 40) return { color: '#f97316', label: 'Poor', grade: 'D' };           // orange
  return { color: '#ef4444', label: 'Critical', grade: 'F' };                        // red
}

export function HealthScore({ score, size = 'lg' }: HealthScoreProps) {
  const safeScore = Math.max(0, Math.min(100, score));
  const band = getBand(safeScore);

  const outerSize = size === 'lg' ? 'w-40 h-40' : 'w-20 h-20';
  const innerSize = size === 'lg' ? 'w-32 h-32' : 'w-16 h-16';
  const scoreText = size === 'lg' ? 'text-4xl' : 'text-xl';
  const subText = size === 'lg' ? 'text-sm' : 'text-[10px]';

  return (
    <div
      className={`${outerSize} rounded-full flex items-center justify-center`}
      style={{
        // Conic gradient: arc fills `safeScore`% of the circle (3.6° per
        // point, 360° total), the rest is gray.
        background: `conic-gradient(${band.color} 0deg ${3.6 * safeScore}deg, #e5e7eb ${3.6 * safeScore}deg 360deg)`,
      }}
      title={`${safeScore}/100 — ${band.label} (${band.grade})`}
    >
      <div className={`${innerSize} bg-white dark:bg-[#111827] rounded-full flex flex-col items-center justify-center`}>
        <span className={`${scoreText} font-bold text-gray-900 dark:text-white`}>{safeScore}</span>
        <span className={`${subText} text-gray-500 dark:text-gray-400`}>out of 100</span>
      </div>
    </div>
  );
}
