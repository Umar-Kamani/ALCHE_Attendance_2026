import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircleIcon, AlertIcon, XIcon } from '../icons';
import { cn } from '../../lib/cn';

type ToastTone = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  title: string;
  message?: string;
  tone: ToastTone;
  action?: ToastAction;
}

interface ToastInput {
  title: string;
  message?: string;
  tone?: ToastTone;
  action?: ToastAction;
  duration?: number;
}

interface ToastContextValue {
  push: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneClasses: Record<ToastTone, string> = {
  success: 'bg-mint text-forest',
  error: 'bg-error-surface text-error-ink',
  info: 'bg-periwinkle-wash text-ink',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    ({ title, message, tone = 'info', action, duration = 6500 }: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, title, message, tone, action }]);
      if (duration > 0) window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex flex-col items-end gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:w-[420px]"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="alche-rise pointer-events-auto w-full rounded-3xl border border-mist bg-snow p-4 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <span className={cn('rounded-md p-1.5', toneClasses[toast.tone])}>
                {toast.tone === 'error' ? <AlertIcon size={18} /> : <CheckCircleIcon size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-ink">{toast.title}</p>
                {toast.message ? <p className="mt-0.5 text-body-sm text-slate">{toast.message}</p> : null}
                {toast.action ? (
                  <button
                    type="button"
                    className="mt-2 text-body-sm font-medium text-slate underline underline-offset-2"
                    onClick={() => {
                      toast.action?.onClick();
                      dismiss(toast.id);
                    }}
                  >
                    {toast.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                className="rounded-md p-1 text-slate hover:text-ink"
                onClick={() => dismiss(toast.id)}
              >
                <XIcon size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
