import React from 'react';
import { cn } from '../../utils/ui';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between',
        className
      )}>
      
      <div className="min-w-0">
        <p className="font-display text-[10px] font-semibold uppercase tracking-wider2 text-aqua">
          {eyebrow}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-chalk sm:text-3xl">
          {title}
        </h1>
        {description &&
        <p className="mt-1.5 max-w-2xl text-sm text-mist">{description}</p>
        }
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>);

}