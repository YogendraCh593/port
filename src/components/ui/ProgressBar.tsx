import React from 'react';
import { cn } from '../../utils/ui';

interface ProgressBarProps {
  value: number;
  tone?: string;
  className?: string;
  height?: string;
}

export function ProgressBar({
  value,
  tone = 'bg-aqua',
  className,
  height = 'h-1.5'
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-abyss', height, className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}>
      
      <div
        className={cn('h-full rounded-full transition-[width] duration-300 ease-out', tone)}
        style={{ width: `${clamped}%` }} />
      
    </div>);

}