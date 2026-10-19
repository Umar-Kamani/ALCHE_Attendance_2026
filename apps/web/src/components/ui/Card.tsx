import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-mist bg-snow p-6 shadow-xl',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        <h2 className="text-subheading font-medium tracking-subheading text-ink">{title}</h2>
        {description ? <p className="mt-1 text-body-sm text-slate">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
