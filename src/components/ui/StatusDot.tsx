import React from 'react';
import { cn } from '../../utils/ui';

interface StatusDotProps {
  color?: string;
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ color = 'bg-ok', pulse = true, className }: StatusDotProps) {
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)}>
      {pulse &&
      <span className={cn('absolute inset-0 rounded-full np-ping opacity-60', color)} />
      }
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', color)} />
    </span>);

}