import { useEffect, useState } from 'react';

export function formatRelativeAge(timestampMs: number | null | undefined, nowMs: number): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) {
    return 'unknown';
  }
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

export function useRelativeAge(timestampMs: number | null | undefined): string {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!timestampMs) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [timestampMs]);

  return formatRelativeAge(timestampMs, nowMs);
}
