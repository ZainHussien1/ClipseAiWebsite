interface SparklineProps {
  values: number[];
  snapshotCount: number;
  color?: string;
  label: string;
}

export function Sparkline({
  values,
  snapshotCount,
  color = 'var(--accent)',
  label,
}: SparklineProps) {
  if (snapshotCount < 3 || values.length < 3) {
    return (
      <span className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
        Collecting snapshots ({snapshotCount}/3)
      </span>
    );
  }

  const width = 96;
  const height = 28;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((val, idx) => {
      const x = pad + (idx / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((val - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-7 w-24 shrink-0"
      role="img"
      aria-label={label}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
