/**
 * OptimizationControlPanel
 * ────────────────────────
 * Full optimizer configuration + run controls.
 * Integrated into PortSimulation page alongside the satellite map.
 */
import React, { useState } from 'react';
import {
  ZapIcon, SlidersHorizontalIcon, RefreshCwIcon,
  BarChart3Icon, InfoIcon, CheckCircle2Icon,
} from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { StatusDot } from '../ui/StatusDot';
import { cn, inputClass } from '../../utils/ui';
import type { OptConfig, OptAlgo, OptMeta } from '../../hooks/useOptimization';

const ALGOS: { value: OptAlgo; label: string; desc: string }[] = [
  { value: 'Auto',    label: 'Auto',    desc: 'Same as Hybrid' },
  { value: 'Hybrid',  label: 'Hybrid',  desc: 'Best of Classical + QAOA' },
  { value: 'QAOA',    label: 'QAOA',    desc: 'Quantum approximate optimizer' },
  { value: 'Greedy',  label: 'Greedy',  desc: 'Priority + aging/fairness' },
  { value: 'SRPT',    label: 'SRPT',    desc: 'Shortest Remaining Processing Time' },
  { value: 'SJF',     label: 'SJF',     desc: 'Shortest Job First' },
  { value: 'FCFS',    label: 'FCFS',    desc: 'First Come First Served' },
];

interface Props {
  config:          OptConfig;
  onConfigChange:  (patch: Partial<OptConfig>) => void;
  onRun:           () => void;
  onCompare:       () => void;
  onReset:         () => void;
  running:         boolean;
  comparing:       boolean;
  meta:            OptMeta | null;
}

export function OptimizationControlPanel({
  config, onConfigChange, onRun, onCompare, onReset,
  running, comparing, meta,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Panel
      eyebrow="Optimization engine"
      title="Control Panel"
      actions={
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="font-mono text-[10px] text-mist hover:text-chalk transition-colors"
        >
          {expanded ? 'COLLAPSE' : 'EXPAND'}
        </button>
      }
    >
      {/* Status bar */}
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-abyss/60 px-3 py-2">
        <StatusDot
          color={running ? 'bg-quantum' : meta ? 'bg-ok' : 'bg-mist'}
          pulse={running}
        />
        <span className="font-mono text-[11px] text-chalk">
          {running
            ? 'SOLVING…'
            : meta
            ? `${meta.algo} · obj=${meta.objective} · ${meta.runtime_s}s`
            : 'IDLE — press Run to optimize'}
        </span>
        {meta?.winner && (
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-ok">
            <CheckCircle2Icon className="h-3 w-3" />
            {meta.winner} won
          </span>
        )}
      </div>

      {/* Algorithm selector */}
      <div className="mb-3">
        <p className="mb-1.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
          Algorithm
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {ALGOS.map(a => (
            <button
              key={a.value}
              type="button"
              onClick={() => onConfigChange({ algo: a.value })}
              title={a.desc}
              className={cn(
                'rounded-lg border px-2.5 py-2 text-left transition-all duration-150',
                config.algo === a.value
                  ? 'border-aqua/60 bg-aqua/[0.08] shadow-[0_0_12px_-4px_rgba(34,211,238,0.4)]'
                  : 'border-line bg-abyss/60 hover:border-edge',
              )}
            >
              <p className={cn(
                'font-display text-[11px] font-bold uppercase tracking-wider',
                config.algo === a.value ? 'text-aqua' : 'text-chalk',
              )}>{a.label}</p>
              <p className="mt-0.5 font-mono text-[9px] text-mist leading-tight">{a.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {expanded && (
        <>
          {/* Crane parameters */}
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Field label="Crane Rate" htmlFor="op-rate" hint="tonnes / min / crane">
              <input
                id="op-rate" type="number" step="1" min="1" className={inputClass}
                value={config.crane_rate_tpm}
                onChange={e => onConfigChange({ crane_rate_tpm: Number(e.target.value) })}
              />
            </Field>
            <Field label="Crane Efficiency" htmlFor="op-eff" hint="0–1 multiplier">
              <input
                id="op-eff" type="number" step="0.05" min="0.1" max="1.0" className={inputClass}
                value={config.efficiency}
                onChange={e => onConfigChange({ efficiency: Number(e.target.value) })}
              />
            </Field>
            <Field label="Crane Count" htmlFor="op-cranes">
              <input
                id="op-cranes" type="number" min="1" max="20" className={inputClass}
                value={config.crane_count}
                onChange={e => onConfigChange({ crane_count: Number(e.target.value) })}
              />
            </Field>
            <Field label="Switch Cost" htmlFor="op-switch" hint="minutes penalty">
              <input
                id="op-switch" type="number" step="1" min="0" className={inputClass}
                value={config.switch_cost}
                onChange={e => onConfigChange({ switch_cost: Number(e.target.value) })}
              />
            </Field>
          </div>

          {/* Fairness / aging */}
          <div className="mb-3">
            <div className="flex items-baseline justify-between mb-1">
              <label
                htmlFor="op-aging"
                className="font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist"
              >
                Fairness / Aging Rate
              </label>
              <span className="font-mono text-[11px] text-aqua">{config.aging_rate}</span>
            </div>
            <input
              id="op-aging" type="range" min="0" max="0.5" step="0.01"
              className="w-full accent-aqua"
              value={config.aging_rate}
              onChange={e => onConfigChange({ aging_rate: Number(e.target.value) })}
            />
            <p className="mt-1 font-mono text-[9px] text-mist/70">
              Higher = faster priority boost for waiting ships (prevents starvation)
            </p>
          </div>

          {/* Toggles */}
          <div className="mb-3 space-y-2">
            {[
              { key: 'rolling',    label: 'Dynamic Re-optimization',  help: 'Re-optimize on every scheduling event' },
              { key: 'preemption', label: 'Crane Preemption',         help: 'Allow interrupting a ship if globally beneficial' },
              { key: 'qaoa_enabled', label: 'QAOA Enabled',           help: 'Use genuine QUBO/QAOA for small fleets' },
            ].map(({ key, label, help }) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-abyss/60 px-3 py-2.5 transition-colors hover:border-edge"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-edge bg-abyss text-aqua focus:ring-aqua"
                  checked={Boolean(config[key as keyof OptConfig])}
                  onChange={e => onConfigChange({ [key]: e.target.checked })}
                />
                <span>
                  <span className="block font-display text-[11px] font-semibold uppercase tracking-wider text-chalk">
                    {label}
                  </span>
                  <span className="block font-mono text-[9px] text-mist">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={<ZapIcon className="h-3.5 w-3.5" />}
          onClick={onRun}
          disabled={running}
          className="flex-1"
        >
          {running ? 'Optimizing…' : 'Run Optimizer'}
        </Button>
        <Button
          icon={<BarChart3Icon className="h-3.5 w-3.5" />}
          onClick={onCompare}
          disabled={comparing}
        >
          {comparing ? 'Comparing…' : 'Compare All'}
        </Button>
        <Button
          variant="ghost"
          icon={<RefreshCwIcon className="h-3.5 w-3.5" />}
          onClick={onReset}
        >
          Reset
        </Button>
      </div>

      {/* Processing time reference */}
      <div className="mt-3 rounded-lg border border-line/50 bg-abyss/40 px-3 py-2">
        <p className="flex items-center gap-1.5 font-mono text-[9px] text-mist">
          <InfoIcon className="h-3 w-3 text-aqua shrink-0" />
          Processing time = cargo ÷ (rate × cranes × efficiency) &nbsp;·&nbsp;
          Example: 100t ÷ ({config.crane_rate_tpm} × 1 × {config.efficiency}) =&nbsp;
          <span className="text-chalk">
            {(100 / (config.crane_rate_tpm * config.efficiency)).toFixed(1)} min
          </span>
        </p>
      </div>
    </Panel>
  );
}
