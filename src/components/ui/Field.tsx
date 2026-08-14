import React from 'react';
import { cn, labelClass } from '../../utils/ui';

interface FieldProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, hint, htmlFor, error, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label className={labelClass} htmlFor={htmlFor}>
          {label}
        </label>
        {hint && <span className="font-mono text-[10px] text-mist/60">{hint}</span>}
      </div>
      {children}
      {error && <p className="font-mono text-[10px] text-crit">{error}</p>}
    </div>);

}