import React from 'react';
import { cn } from '../../utils/ui';

interface DataRowProps {
  label: string;
  value: React.ReactNode;
  tone?: string;
  className?: string;
}

export function DataRow({ label, value, tone = 'text-chalk', className }: DataRowProps) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 border-b border-line/60 py-2 last:border-b-0',
        className
      )}>
      
      <dt className="font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
        {label}
      </dt>
      <dd className={cn('font-mono text-[13px] tabular-nums', tone)}>{value}</dd>
    </div>);

}