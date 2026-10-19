import { ShieldIcon } from './icons';
import { cn } from '../lib/cn';

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-monday-violet text-snow">
        <ShieldIcon size={21} />
      </span>
      {compact ? null : (
        <span className="min-w-0">
          <span className="block truncate text-body-sm font-bold tracking-body text-ink">
            ALCHE Campus Post
          </span>
          <span className="block truncate text-caption text-slate">Security operations</span>
        </span>
      )}
    </div>
  );
}
