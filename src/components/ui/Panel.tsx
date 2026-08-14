import React from 'react';
import { cn } from '../../utils/ui';

interface PanelProps {
  title?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  grid?: boolean;
}

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className,
  bodyClassName,
  grid = false
}: PanelProps) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-xl border border-line bg-deck/70 shadow-panel backdrop-blur-md',
        className
      )}>
      
      {grid && <div className="pointer-events-none absolute inset-0 np-grid opacity-[0.35]" />}
      {(title || actions) &&
      <header className="relative flex items-start justify-between gap-4 border-b border-line/80 px-4 py-3">
          <div className="min-w-0">
            {eyebrow &&
          <p className="font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
                {eyebrow}
              </p>
          }
            {title &&
          <h2 className="truncate font-display text-sm font-semibold uppercase tracking-wider text-chalk">
                {title}
              </h2>
          }
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      }
      <div className={cn('relative p-4', bodyClassName)}>{children}</div>
    </section>);

}