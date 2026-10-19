import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';

interface FieldMeta {
  label?: string;
  error?: string | string[];
  hint?: string;
  required?: boolean;
}

function getError(error?: string | string[]): string | undefined {
  if (!error) return undefined;
  return Array.isArray(error) ? error[0] : error;
}

const fieldBase =
  'w-full rounded-md border border-mist bg-snow px-3 text-ink placeholder:text-slate/70 transition-colors duration-150 focus-visible:border-monday-violet disabled:border-iron disabled:bg-cloud disabled:text-iron aria-[invalid=true]:border-error-ink';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldMeta {
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, required, suffix, className, id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorText = getError(error);
  const descriptionId = errorText || hint ? `${inputId}-description` : undefined;

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-body-sm font-medium text-ink">
          {label}
          {required ? <span className="ml-1 text-slate">*</span> : null}
        </label>
      ) : null}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={descriptionId}
          className={cn(fieldBase, 'min-h-12', suffix ? 'pr-11' : '', className)}
          {...props}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate">
            {suffix}
          </span>
        ) : null}
      </div>
      {errorText ? (
        <p id={descriptionId} className="mt-1.5 text-body-sm text-error-ink">
          {errorText}
        </p>
      ) : hint ? (
        <p id={descriptionId} className="mt-1.5 text-body-sm text-slate">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldMeta {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, required, options, placeholder, className, id, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const errorText = getError(error);

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={selectId} className="mb-1.5 block text-body-sm font-medium text-ink">
          {label}
          {required ? <span className="ml-1 text-slate">*</span> : null}
        </label>
      ) : null}
      <select
        ref={ref}
        id={selectId}
        required={required}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={errorText || hint ? `${selectId}-description` : undefined}
        className={cn(fieldBase, 'min-h-12 cursor-pointer appearance-none pr-9', className)}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {errorText ? (
        <p id={`${selectId}-description`} className="mt-1.5 text-body-sm text-error-ink">
          {errorText}
        </p>
      ) : hint ? (
        <p id={`${selectId}-description`} className="mt-1.5 text-body-sm text-slate">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldMeta {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, required, className, id, rows = 3, ...props },
  ref,
) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const errorText = getError(error);

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={textareaId} className="mb-1.5 block text-body-sm font-medium text-ink">
          {label}
          {required ? <span className="ml-1 text-slate">*</span> : null}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        required={required}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={errorText || hint ? `${textareaId}-description` : undefined}
        className={cn(fieldBase, 'min-h-24 py-2.5 leading-body', className)}
        {...props}
      />
      {errorText ? (
        <p id={`${textareaId}-description`} className="mt-1.5 text-body-sm text-error-ink">
          {errorText}
        </p>
      ) : hint ? (
        <p id={`${textareaId}-description`} className="mt-1.5 text-body-sm text-slate">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export function Field({ children }: { children: ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}
