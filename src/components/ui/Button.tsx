import React from 'react';
import { cn } from '../../utils/ui';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
  'bg-aqua/15 text-aqua border-aqua/50 hover:bg-aqua/25 hover:border-aqua/80 active:translate-y-px',
  secondary:
  'bg-white/[0.03] text-mist border-line hover:text-chalk hover:border-edge hover:bg-white/[0.06] active:translate-y-px',
  ghost: 'bg-transparent text-mist border-transparent hover:text-chalk hover:bg-white/[0.05]',
  danger:
  'bg-crit/12 text-crit border-crit/45 hover:bg-crit/20 hover:border-crit/70 active:translate-y-px'
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border font-display font-semibold uppercase tracking-wider transition-[background-color,border-color,color,transform] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'px-2.5 py-1.5 text-[10px]' : 'px-3.5 py-2 text-[11px]',
        variants[variant],
        className
      )}>
      
      {icon}
      {children}
    </button>);

}