import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <section
      className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] ${className}`}
    >
      {children}
    </section>
  );
}
