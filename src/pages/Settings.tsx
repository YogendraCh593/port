import React, { useState } from 'react';
import { toast } from 'sonner';
import { RotateCcwIcon, PowerIcon, SaveIcon, AnchorIcon, CheckIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { usePort } from '../contexts/PortContext';
import { defaultSettings } from '../data/port';
import { cn, inputClass } from '../utils/ui';
import type { PortSettings } from '../types';

export function Settings() {
  const {
    settings,
    updateSettings,
    berths,
    updateBerth,
    cranes,
    updateCrane,
    runOptimization,
    speed,
    setSpeed,
    portList,
    activePort,
    selectPort,
    scenario,
    updateScenario,
    craneSettings,
    updateCraneSettings,
  } = usePort();

  const [portChanging, setPortChanging] = useState(false);

  async function handlePortChange(name: string) {
    if (name === activePort?.name) return;
    setPortChanging(true);
    try {
      await selectPort(name);
      toast.success('Port changed', { description: name });
    } catch {
      toast.error('Failed to change port');
    } finally {
      setPortChanging(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="System configuration"
        title="Settings"
        description="Operational parameters that feed the ETA calculations, the berth allocation objective and the simulation clock."
        actions={
          <>
            <Button
              icon={<RotateCcwIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                updateSettings(defaultSettings);
                toast('Configuration restored to defaults');
              }}
            >
              Restore Defaults
            </Button>
            <Button
              variant="primary"
              icon={<SaveIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                runOptimization();
                toast.success('Configuration applied', {
                  description: 'Berth allocation re-solved with the current parameters.',
                });
              }}
            >
              Apply & Re-solve
            </Button>
          </>
        }
      />

      {/* ── Port Selection ──────────────────────────────────────────────── */}
      <Panel eyebrow="Active port" title="Port Selection" grid className="mb-3">
        <p className="mb-3 font-mono text-[11px] text-mist">
          Select one of the four Indian ports. Switching port clears the optimization and reloads
          berth profiles from the backend.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {portList.map((p) => {
            const active = p.key === activePort?.name;
            return (
              <button
                key={p.key}
                type="button"
                disabled={portChanging}
                onClick={() => handlePortChange(p.key)}
                className={cn(
                  'relative rounded-xl border p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5',
                  active
                    ? 'border-aqua/60 bg-aqua/[0.08] shadow-[0_0_20px_-8px_rgba(34,211,238,0.4)]'
                    : 'border-line bg-deck/70 hover:border-edge',
                )}
              >
                {active && (
                  <span className="absolute right-3 top-3">
                    <CheckIcon className="h-4 w-4 text-aqua" aria-hidden />
                  </span>
                )}
                <span className="flex items-center gap-2">
                  <AnchorIcon
                    className={cn('h-4 w-4 shrink-0', active ? 'text-aqua' : 'text-mist')}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      'font-display text-[11px] font-bold uppercase tracking-wider',
                      active ? 'text-aqua' : 'text-chalk',
                    )}
                  >
                    {p.short}
                  </span>
                </span>
                <p className="mt-1.5 font-mono text-[10px] text-mist">{p.state}</p>
                <p className="mt-1 font-mono text-[10px] text-chalk/80">
                  {p.berths} berths · {p.lat.toFixed(2)}°N {p.lon.toFixed(2)}°E
                </p>
                <p className="mt-1 font-mono text-[9px] leading-snug text-mist/70">{p.notes}</p>
              </button>
            );
          })}
        </div>
      </Panel>

      {/* ── Scenario ────────────────────────────────────────────────────── */}
      <Panel eyebrow="Scenario parameters" title="Operational Scenario" grid className="mb-3">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Vessels in Scenario" htmlFor="sc-ships">
            <input
              id="sc-ships"
              type="number"
              min={1}
              max={200}
              className={inputClass}
              value={scenario.ships}
              onChange={(e) => updateScenario({ ...scenario, ships: Number(e.target.value) })}
            />
          </Field>
          <Field label="Avg Unloading Time (h)" htmlFor="sc-hours">
            <input
              id="sc-hours"
              type="number"
              step={0.5}
              min={0.5}
              className={inputClass}
              value={scenario.unload_hours}
              onChange={(e) =>
                updateScenario({ ...scenario, unload_hours: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Planned Cargo Volume (TEU)" htmlFor="sc-teu">
            <input
              id="sc-teu"
              type="number"
              step={100}
              min={100}
              className={inputClass}
              value={scenario.load_teu}
              onChange={(e) => updateScenario({ ...scenario, load_teu: Number(e.target.value) })}
            />
          </Field>
          <Field label="Operational Priority (1–5)" htmlFor="sc-priority">
            <input
              id="sc-priority"
              type="range"
              min={1}
              max={5}
              step={1}
              className="w-full accent-aqua"
              value={scenario.priority}
              onChange={(e) =>
                updateScenario({ ...scenario, priority: Number(e.target.value) })
              }
            />
            <span className="font-mono text-[11px] text-aqua">{scenario.priority}</span>
          </Field>
          <div className="flex items-center gap-3 pt-5">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-edge bg-abyss text-aqua focus:ring-aqua"
                checked={scenario.disaster}
                onChange={(e) =>
                  updateScenario({ ...scenario, disaster: e.target.checked })
                }
              />
              <span className="font-display text-[11px] font-semibold uppercase tracking-wider text-chalk">
                Emergency Cargo Mode
              </span>
            </label>
          </div>
        </div>
      </Panel>

      {/* ── Crane Settings ───────────────────────────────────────────────── */}
      <Panel eyebrow="Equipment" title="Crane & Transport Settings" grid className="mb-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Available Cranes" htmlFor="cs-cranes">
            <input
              id="cs-cranes"
              type="number"
              min={1}
              max={50}
              className={inputClass}
              value={craneSettings.cranes}
              onChange={(e) =>
                updateCraneSettings({ ...craneSettings, cranes: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Transport Capacity per Crane (t/h)" htmlFor="cs-rate">
            <input
              id="cs-rate"
              type="number"
              step={50}
              min={50}
              className={inputClass}
              value={craneSettings.rate_tph}
              onChange={(e) =>
                updateCraneSettings({ ...craneSettings, rate_tph: Number(e.target.value) })
              }
            />
          </Field>
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        {/* ── Port Reference ─────────────────────────────────────────────── */}
        <Panel eyebrow="Reference frame" title="Port Configuration" grid>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Port Name" htmlFor="st-name" className="sm:col-span-2">
              <input
                id="st-name"
                className={inputClass}
                value={settings.portName}
                onChange={(e) => updateSettings({ portName: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Port Latitude" htmlFor="st-lat" hint="decimal °">
              <input
                id="st-lat"
                type="number"
                step="0.01"
                className={inputClass}
                value={settings.portLat}
                onChange={(e) => updateSettings({ portLat: Number(e.target.value) })}
              />
            </Field>
            <Field label="Port Longitude" htmlFor="st-lon" hint="decimal °">
              <input
                id="st-lon"
                type="number"
                step="0.01"
                className={inputClass}
                value={settings.portLon}
                onChange={(e) => updateSettings({ portLon: Number(e.target.value) })}
              />
            </Field>
            <Field label="Timezone Label" htmlFor="st-tz" className="sm:col-span-2">
              <input
                id="st-tz"
                className={inputClass}
                value={settings.timezoneLabel}
                onChange={(e) => updateSettings({ timezoneLabel: e.target.value })}
              />
            </Field>
          </div>
          {activePort && (
            <div className="mt-3 rounded-lg border border-line bg-abyss/60 px-3 py-2.5">
              <p className="font-mono text-[10px] text-mist">
                <span className="text-aqua">{activePort.short}</span> · {activePort.state} ·{' '}
                {activePort.berths} berths
              </p>
              <p className="mt-0.5 font-mono text-[9px] text-mist/70">{activePort.notes}</p>
              <a
                href={activePort.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 block font-mono text-[9px] text-aqua hover:underline"
              >
                {activePort.source}
              </a>
            </div>
          )}
        </Panel>

        {/* ── Solver Parameters ─────────────────────────────────────────── */}
        <Panel eyebrow="Solver objective" title="Optimization Parameters" grid>
          <div className="space-y-4">
            {[
              {
                key: 'waitingWeight' as const,
                label: 'Waiting Time Weight',
                min: 0, max: 5, step: 0.1,
                help: 'Penalty applied per hour a vessel waits for its berth.',
              },
              {
                key: 'spoilageWeight' as const,
                label: 'Spoilage Weight',
                min: 0, max: 10, step: 0.5,
                help: 'Penalty for eroding or breaching a cargo spoilage deadline.',
              },
              {
                key: 'priorityWeight' as const,
                label: 'Cargo Priority Weight',
                min: 0, max: 5, step: 0.1,
                help: 'Extra weight given to high and critical priority cargo.',
              },
            ].map((cfg) => (
              <div key={cfg.key}>
                <div className="flex items-baseline justify-between">
                  <label
                    htmlFor={`st-${cfg.key}`}
                    className="font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist"
                  >
                    {cfg.label}
                  </label>
                  <span className="font-mono text-[12px] text-aqua">{settings[cfg.key]}</span>
                </div>
                <input
                  id={`st-${cfg.key}`}
                  type="range"
                  min={cfg.min}
                  max={cfg.max}
                  step={cfg.step}
                  value={settings[cfg.key]}
                  onChange={(e) =>
                    updateSettings({ [cfg.key]: Number(e.target.value) } as Partial<PortSettings>)
                  }
                  className="mt-2 w-full accent-aqua"
                />
                <p className="mt-1 font-mono text-[10px] text-mist/80">{cfg.help}</p>
              </div>
            ))}
            <Field label="Annealing Iterations" htmlFor="st-iters" hint="solver effort">
              <input
                id="st-iters"
                type="number"
                min={50}
                max={5000}
                step={50}
                className={inputClass}
                value={settings.annealIterations}
                onChange={(e) => updateSettings({ annealIterations: Number(e.target.value) })}
              />
            </Field>
          </div>
        </Panel>

        {/* ── Berth Configuration ──────────────────────────────────────── */}
        <Panel eyebrow="Estate" title="Berth Configuration" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-line/70 bg-abyss/40">
                  {['Berth', 'Max LOA', 'Max Draft', 'Crane Slots', 'Service'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {berths.map((berth) => (
                  <tr key={berth.id} className="border-b border-line/50">
                    <td className="px-4 py-2 font-mono text-[12px] text-chalk">{berth.name}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        aria-label={`${berth.name} max LOA`}
                        className={cn(inputClass, 'w-20 py-1 text-[11px]')}
                        value={berth.maxLoa}
                        onChange={(e) => updateBerth(berth.id, { maxLoa: Number(e.target.value) })}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        step="0.1"
                        aria-label={`${berth.name} max draft`}
                        className={cn(inputClass, 'w-20 py-1 text-[11px]')}
                        value={berth.maxDraft}
                        onChange={(e) =>
                          updateBerth(berth.id, { maxDraft: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-mist">
                      {cranes.filter((c) => c.berthId === berth.id).length} / {berth.craneSlots}
                    </td>
                    <td className="px-4 py-2">
                      <Button
                        size="sm"
                        variant={berth.status === 'operational' ? 'secondary' : 'primary'}
                        icon={<PowerIcon className="h-3 w-3" />}
                        onClick={() =>
                          updateBerth(berth.id, {
                            status: berth.status === 'operational' ? 'maintenance' : 'operational',
                          })
                        }
                      >
                        {berth.status === 'operational' ? 'Offline' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ── Crane Configuration ──────────────────────────────────────── */}
        <Panel eyebrow="Equipment" title="Crane Configuration" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-line/70 bg-abyss/40">
                  {['Crane', 'Berth', 'Rated t/h', 'Service'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cranes.map((crane) => (
                  <tr key={crane.id} className="border-b border-line/50">
                    <td className="px-4 py-2 font-mono text-[12px] text-chalk">{crane.name}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-mist">{crane.berthId}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        aria-label={`${crane.name} rated throughput`}
                        className={cn(inputClass, 'w-24 py-1 text-[11px]')}
                        value={crane.capacityTph}
                        onChange={(e) =>
                          updateCrane(crane.id, { capacityTph: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Button
                        size="sm"
                        variant={crane.status === 'operational' ? 'secondary' : 'primary'}
                        icon={<PowerIcon className="h-3 w-3" />}
                        onClick={() =>
                          updateCrane(crane.id, {
                            status: crane.status === 'operational' ? 'maintenance' : 'operational',
                          })
                        }
                      >
                        {crane.status === 'operational' ? 'Offline' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ── Simulation Clock ─────────────────────────────────────────── */}
        <Panel eyebrow="Clock" title="Simulation Parameters" grid>
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
                  Clock Multiplier
                </span>
                <span className="font-mono text-[12px] text-aqua">{speed}×</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[1, 30, 60, 300, 900].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={cn(
                      'rounded border px-2.5 py-1 font-mono text-[10px] transition-colors duration-150 ease-out',
                      speed === s
                        ? 'border-aqua/60 bg-aqua/12 text-aqua'
                        : 'border-line text-mist hover:border-edge hover:text-chalk',
                    )}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
            <Field label="Default Simulation Speed" htmlFor="st-simspeed" hint="used on reset">
              <input
                id="st-simspeed"
                type="number"
                min={1}
                max={3600}
                className={inputClass}
                value={settings.simulationSpeed}
                onChange={(e) => updateSettings({ simulationSpeed: Number(e.target.value) })}
              />
            </Field>
          </div>
        </Panel>

        {/* ── Display ──────────────────────────────────────────────────── */}
        <Panel eyebrow="Display" title="System Preferences" grid>
          <div className="space-y-2.5">
            {[
              {
                key: 'showRouteLines' as const,
                label: 'Navigation Route Lines',
                help: 'Draw the approach track from each inbound vessel to the port.',
              },
              {
                key: 'showVesselLabels' as const,
                label: 'Vessel Labels on Map',
                help: 'Show ship IDs beside every vessel symbol.',
              },
            ].map((pref) => (
              <label
                key={pref.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-abyss/60 px-3 py-2.5 transition-colors duration-150 ease-out hover:border-edge"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-edge bg-abyss text-aqua focus:ring-aqua"
                  checked={settings[pref.key]}
                  onChange={(e) =>
                    updateSettings({ [pref.key]: e.target.checked } as Partial<PortSettings>)
                  }
                />
                <span>
                  <span className="block font-display text-[11px] font-semibold uppercase tracking-wider text-chalk">
                    {pref.label}
                  </span>
                  <span className="block font-mono text-[10px] text-mist">{pref.help}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-mist/70">
            NEXUSPORT · BUILD 2026.08 · BACKEND: PYTHON FASTAPI · SOLVER: QUBO/QAOA
          </p>
        </Panel>
      </div>
    </>
  );
}
