import { twMerge } from 'tailwind-merge';

export function cn(...parts: (string | false | null | undefined)[]): string {
  return twMerge(parts.filter(Boolean).join(' '));
}

export const inputClass =
'w-full rounded-md border border-line bg-abyss/80 px-3 py-2 font-mono text-sm text-chalk placeholder:text-mist/40 transition-colors duration-150 ease-out hover:border-edge focus:border-aqua/70 focus:bg-abyss';

export const labelClass =
'block text-[10px] font-semibold uppercase tracking-wider2 text-mist';

export const eyebrowClass =
'font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist';

export const severityToken = {
  critical: { text: 'text-crit', bg: 'bg-crit/10', border: 'border-crit/40', dot: 'bg-crit' },
  warning: { text: 'text-warn', bg: 'bg-warn/10', border: 'border-warn/40', dot: 'bg-warn' },
  info: { text: 'text-aqua', bg: 'bg-aqua/10', border: 'border-aqua/40', dot: 'bg-aqua' },
  system: { text: 'text-mist', bg: 'bg-white/5', border: 'border-edge/60', dot: 'bg-mist' }
} as const;