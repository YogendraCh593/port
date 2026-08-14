import React from 'react';
import { TrendingDownIcon, TrendingUpIcon, MinusIcon } from 'lucide-react';
import { cn } from '../../utils/ui';

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
  trend?: {dir: 'up' | 'down' | 'flat';text: string;good?: boolean;};
  support?: string;
  tone?: string;
  featured?: boolean;
  className?: string;
}

export function KpiCard({
  label,
  value,
  unit,
  icon,
  trend,
  support,
  tone = 'text-aqua',
  featured = false,
  className
}: KpiCardProps) {
  const TrendIcon =
  trend?.dir === 'up' ? TrendingUpIcon : trend?.dir === 'down' ? TrendingDownIcon : MinusIcon;
  const trendGood = trend?.good ?? trend?.dir === 'up';

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-xl border border-line bg-deck/70 p-4 shadow-panel backdrop-blur-md transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-edge hover:bg-deck',
        className
      )}>
      
      <div className={cn('pointer-events-none absolute -right-10 -top-12', tone)} aria-hidden>
        <div className="h-28 w-28 rounded-full bg-current opacity-[0.07] blur-2xl transition-opacity duration-200 group-hover:opacity-20" />
      </div>
      <div className="relative flex items-start justify-between gap-3">
        <p className="font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
          {label}
        </p>
        <span className={cn('shrink-0 opacity-70', tone)}>{icon}</span>
      </div>
      <div className="relative mt-3 flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-display font-semibold tabular-nums text-chalk',
            featured ? 'text-5xl leading-none' : 'text-3xl leading-none'
          )}>
          
          {value}
        </span>
        {unit && <span className="font-mono text-xs text-mist">{unit}</span>}
      </div>
      <div className="relative mt-3 flex items-center justify-between gap-2">
        {support ?
        <p className="truncate font-mono text-[11px] text-mist/80">{support}</p> :

        <span />
        }
        {trend &&
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 font-mono text-[11px]',
            trend.dir === 'flat' ? 'text-mist' : trendGood ? 'text-ok' : 'text-crit'
          )}>
          
            <TrendIcon className="h-3 w-3" aria-hidden />
            {trend.text}
          </span>
        }
      </div>
    </article>);

}