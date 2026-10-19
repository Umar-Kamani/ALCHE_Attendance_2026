import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { AlertIcon, RefreshIcon } from '../icons';
import { Button } from './Button';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('alche-scrollbar w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[720px] border-collapse text-left">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-mist">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-mist">{children}</tbody>;
}

export function TR({ children, className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('transition-colors duration-150 hover:bg-cloud/70', className)} {...props}>
      {children}
    </tr>
  );
}

export function TH({ children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap px-3 py-3 text-caption font-medium uppercase tracking-caption text-slate first:pl-0 last:pr-0',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TD({ children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('px-3 py-3.5 text-body-sm text-ink first:pl-0 last:pr-0', className)}
      {...props}
    >
      {children}
    </td>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('alche-skeleton block h-4 rounded-md', className)} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-10 flex-1', columnIndex === 0 ? 'max-w-[180px]' : '')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-mist bg-snow px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full-2 bg-periwinkle text-slate">
        <AlertIcon />
      </div>
      <h3 className="text-subheading font-medium tracking-subheading text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-body-sm text-slate">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'We could not load this screen.',
  description = 'The server did not answer as expected. Try again.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-3xl border border-error-surface bg-snow px-6 py-12 text-center"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full-2 bg-error-surface text-error-ink">
        <AlertIcon />
      </div>
      <h3 className="text-subheading font-medium tracking-subheading text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-body-sm text-slate">{description}</p>
      {onRetry ? (
        <Button
          variant="outlined"
          className="mt-5"
          icon={<RefreshIcon size={18} />}
          onClick={onRetry}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-heading-sm font-medium tracking-heading-sm text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-body-sm text-slate">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <p className="text-body-sm text-slate">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <Button variant="outlined" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          variant="outlined"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
