import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'filled' | 'outlined' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'kiosk';

const variantClasses: Record<ButtonVariant, string> = {
  filled:
    'border border-transparent bg-monday-violet text-snow hover:opacity-90 disabled:border-transparent disabled:bg-shadow-dust disabled:text-slate disabled:opacity-100',
  outlined:
    'border border-slate bg-transparent text-ink hover:bg-cloud disabled:border-iron disabled:text-iron disabled:hover:bg-transparent',
  text: 'border border-transparent bg-transparent text-slate hover:text-ink disabled:text-iron',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-10 px-4 text-body-sm',
  md: 'min-h-12 px-6 text-body-sm',
  lg: 'min-h-13 px-7 text-body',
  kiosk: 'min-h-14 px-8 text-body',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'filled',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-full-2 font-medium leading-none transition-all duration-150 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

export { variantClasses as buttonVariantClasses, sizeClasses as buttonSizeClasses };
