import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type StatusTone =
  | 'PRESENT'
  | 'ON_SITE'
  | 'MISSING_IN'
  | 'OVERDUE'
  | 'ABSENT'
  | 'FREE'
  | 'OCCUPIED'
  | 'INACTIVE'
  | 'NEUTRAL'
  | 'ERROR';

const toneClasses: Record<StatusTone, string> = {
  PRESENT: 'bg-mint text-forest',
  ON_SITE: 'bg-aqua text-ink',
  MISSING_IN: 'bg-error-surface text-error-ink',
  OVERDUE: 'bg-error-surface text-error-ink',
  ABSENT: 'bg-shadow-dust text-slate',
  FREE: 'bg-mint text-forest',
  OCCUPIED: 'bg-aqua text-ink',
  INACTIVE: 'bg-shadow-dust text-slate',
  NEUTRAL: 'bg-periwinkle-wash text-ink',
  ERROR: 'bg-error-surface text-error-ink',
};

export function statusToneFor(value: string): StatusTone {
  switch (value) {
    case 'PRESENT':
    case 'FREE':
    case 'DEPARTED':
      return 'PRESENT';
    case 'ON_SITE':
    case 'OCCUPIED':
      return 'ON_SITE';
    case 'MISSING_IN':
      return 'MISSING_IN';
    case 'OVERDUE':
      return 'OVERDUE';
    case 'ABSENT':
      return 'ABSENT';
    case 'INACTIVE':
    case 'CANCELLED':
      return 'INACTIVE';
    case 'EXPECTED':
      return 'NEUTRAL';
    default:
      return 'NEUTRAL';
  }
}

export interface StatusPillProps {
  children: ReactNode;
  tone?: StatusTone;
  status?: string;
  className?: string;
}

export function StatusPill({ children, tone, status, className }: StatusPillProps) {
  const resolvedTone = tone ?? (status ? statusToneFor(status) : 'NEUTRAL');
  return (
    <span
      data-tone={resolvedTone}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-caption font-medium leading-caption tracking-caption',
        toneClasses[resolvedTone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md bg-periwinkle-wash px-2 py-0.5 text-caption font-medium text-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

export { toneClasses as statusToneClasses };
