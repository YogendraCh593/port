import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  ShipIcon,
  PackageIcon,
  RulerIcon,
  SettingsIcon,
  NavigationIcon,
  TimerIcon,
  TriangleAlertIcon,
  CheckCircle2Icon,
  Trash2Icon,
} from 'lucide-react';
import { usePort } from '../../contexts/PortContext';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { DataRow } from '../ui/DataRow';
import { cn, inputClass } from '../../utils/ui';
import { deriveVessel, fmtDate, fmtDuration, fmtNumber, fmtTime } from '../../utils/geo';
import type { CargoType, Vessel } from '../../types';

const cargoTypes: CargoType[] = ['Containers', 'Bulk', 'Liquid', 'Reefer', 'RoRo', 'General'];

interface FormState {
  id: string;
  operator: string;
  cargoType: CargoType;
  loadTonnes: string;
  teu: string;
  spoilable: boolean;
  spoilageWindowHours: string;
  loa: string;
  draft: string;
  unloadingHours: string;
  speedKnots: string;
  lat: string;
  lon: string;
  departure: string;
}

const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

function blankForm(nextId: string, now: Date): FormState {
  return {
    id: nextId,
    operator: '',
    cargoType: 'Containers',
    loadTonnes: '',
    teu: '',
    spoilable: false,
    spoilageWindowHours: '24',
    loa: '',
    draft: '',
    unloadingHours: '',
    speedKnots: '',
    lat: '',
    lon: '',
    departure: toLocalInput(now),
  };
}

export function VesselRegistrationConsole() {
  const {
    vessels,
    addVessel,
    removeVessel,
    clearVessels,
    berths,
    port,
    now,
    drafts,
    saveDraft,
    removeDraft,
    activePort,
  } = usePort();

  const nextId = useMemo(() => {
    const nums = vessels
      .map((v) => Number(v.id.replace(/[^0-9]/g, '')))
      .filter((n) => Number.isFinite(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `SHP-${String(next).padStart(3, '0')}`;
  }, [vessels]);

  const [form, setForm] = useState<FormState>(() => blankForm(nextId, now));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

  const candidate: Vessel = {
    id: form.id.trim() || nextId,
    operator: form.operator.trim() || '—',
    cargoType: form.cargoType,
    loadTonnes: num(form.loadTonnes) || 0,
    teu: num(form.teu) || 0,
    loa: num(form.loa) || 0,
    draft: num(form.draft) || 0,
    unloadingHours: num(form.unloadingHours) || 0,
    speedKnots: num(form.speedKnots) || 0,
    lat: Number.isFinite(num(form.lat)) ? num(form.lat) : port.lat,
    lon: Number.isFinite(num(form.lon)) ? num(form.lon) : port.lon,
    departure: new Date(form.departure || now).toISOString(),
    spoilable: form.spoilable,
    spoilageWindowHours: form.spoilable ? num(form.spoilageWindowHours) || 0 : 0,
    status: 'approaching',
  };

  const preview = deriveVessel(candidate, port);
  const feasibleBerths = berths.filter(
    (b) => b.status === 'operational' && candidate.loa <= b.maxLoa && candidate.draft <= b.maxDraft,
  );
  const hasDims = candidate.loa > 0 && candidate.draft > 0;

  // Operating window from active port (India region)
  const latMin = -20, latMax = 23, lonMin = 75, lonMax = 100;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.id.trim()) next.id = 'Ship ID required';
    else if (vessels.some((v) => v.id.toLowerCase() === form.id.trim().toLowerCase()))
      next.id = 'Ship ID already registered';
    if (!form.operator.trim()) next.operator = 'Operator required';
    if (!(num(form.loadTonnes) > 0)) next.loadTonnes = 'Load must be greater than 0';
    if (!(num(form.loa) > 0)) next.loa = 'LOA required';
    if (!(num(form.draft) > 0)) next.draft = 'Draft required';
    if (!(num(form.unloadingHours) > 0)) next.unloadingHours = 'Unloading time required';
    if (!(num(form.speedKnots) > 0)) next.speedKnots = 'Speed required';
    const lat = num(form.lat);
    const lon = num(form.lon);
    if (!Number.isFinite(lat) || lat < latMin || lat > latMax)
      next.lat = `Latitude must be between ${latMin}° and ${latMax}°`;
    if (!Number.isFinite(lon) || lon < lonMin || lon > lonMax)
      next.lon = `Longitude must be between ${lonMin}° and ${lonMax}°`;
    if (form.spoilable && !(num(form.spoilageWindowHours) > 0))
      next.spoilageWindowHours = 'Spoilage window required';
    if (!form.departure) next.departure = 'Departure timestamp required';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) {
      toast.error('Registration rejected', {
        description: 'Resolve the highlighted fields before transmitting.',
      });
      return;
    }
    setSubmitting(true);
    try {
      await addVessel(candidate);
      toast.success(`${candidate.id} registered`, {
        description: `ETA ${fmtDate(preview.eta)} ${fmtTime(preview.eta)} · ${fmtNumber(preview.distanceKm)} km out`,
      });
      const newNum =
        (Number(candidate.id.replace(/[^0-9]/g, '')) || vessels.length) + 1;
      setForm(blankForm(`SHP-${String(newNum).padStart(3, '0')}`, now));
      setErrors({});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Registration failed', { description: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <form onSubmit={submit} className="space-y-3 xl:col-span-2">
        {/* ── Identity ── */}
        <Panel eyebrow="Section 01" title="Vessel Identity" grid>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ship ID" htmlFor="vs-id" hint={`suggested ${nextId}`} error={errors.id}>
              <input
                id="vs-id"
                className={inputClass}
                value={form.id}
                onChange={(e) => set('id', e.target.value.toUpperCase())}
                placeholder="SHP-013"
              />
            </Field>
            <Field label="Operator" htmlFor="vs-operator" error={errors.operator}>
              <input
                id="vs-operator"
                className={inputClass}
                value={form.operator}
                onChange={(e) => set('operator', e.target.value)}
                placeholder="Maersk"
              />
            </Field>
          </div>
        </Panel>

        {/* ── Cargo ── */}
        <Panel eyebrow="Section 02" title="Cargo Profile" grid>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Cargo Type" htmlFor="vs-cargo">
              <select
                id="vs-cargo"
                className={inputClass}
                value={form.cargoType}
                onChange={(e) => set('cargoType', e.target.value as CargoType)}
              >
                {cargoTypes.map((c) => (
                  <option key={c} value={c} className="bg-abyss">
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Load Weight" htmlFor="vs-load" hint="tonnes" error={errors.loadTonnes}>
              <input
                id="vs-load"
                type="number"
                min="0"
                className={inputClass}
                value={form.loadTonnes}
                onChange={(e) => set('loadTonnes', e.target.value)}
                placeholder="5000"
              />
            </Field>
            <Field label="TEU" htmlFor="vs-teu" hint="containers">
              <input
                id="vs-teu"
                type="number"
                min="0"
                className={inputClass}
                value={form.teu}
                onChange={(e) => set('teu', e.target.value)}
                placeholder="2500"
              />
            </Field>
          </div>
          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-abyss/60 px-3 py-2.5 transition-colors duration-150 ease-out hover:border-edge">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-edge bg-abyss text-aqua focus:ring-aqua"
              checked={form.spoilable}
              onChange={(e) => set('spoilable', e.target.checked)}
            />
            <span>
              <span className="block font-display text-[11px] font-semibold uppercase tracking-wider text-chalk">
                Spoilable Cargo
              </span>
              <span className="block font-mono text-[10px] text-mist">
                Enables the spoilage deadline constraint in berth allocation
              </span>
            </span>
          </label>
        </Panel>

        {/* ── Dimensions & Operational ── */}
        <div className="grid gap-3 md:grid-cols-2">
          <Panel eyebrow="Section 03" title="Vessel Dimensions" grid>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="LOA" htmlFor="vs-loa" hint="metres" error={errors.loa}>
                <input
                  id="vs-loa"
                  type="number"
                  min="0"
                  className={inputClass}
                  value={form.loa}
                  onChange={(e) => set('loa', e.target.value)}
                  placeholder="280"
                />
              </Field>
              <Field label="Draft" htmlFor="vs-draft" hint="metres" error={errors.draft}>
                <input
                  id="vs-draft"
                  type="number"
                  step="0.1"
                  min="0"
                  className={inputClass}
                  value={form.draft}
                  onChange={(e) => set('draft', e.target.value)}
                  placeholder="12"
                />
              </Field>
            </div>
            {hasDims && (
              <p
                className={cn(
                  'mt-3 flex items-center gap-2 font-mono text-[10px]',
                  feasibleBerths.length ? 'text-ok' : 'text-crit',
                )}
              >
                {feasibleBerths.length ? (
                  <CheckCircle2Icon className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <TriangleAlertIcon className="h-3.5 w-3.5" aria-hidden />
                )}
                {feasibleBerths.length
                  ? `FITS ${feasibleBerths.map((b) => b.id).join(' · ')}`
                  : 'NO OPERATIONAL BERTH ACCEPTS THESE DIMENSIONS'}
              </p>
            )}
          </Panel>

          <Panel eyebrow="Section 04" title="Operational Parameters" grid>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Unloading Time"
                htmlFor="vs-unload"
                hint="hours"
                error={errors.unloadingHours}
              >
                <input
                  id="vs-unload"
                  type="number"
                  step="0.5"
                  min="0"
                  className={inputClass}
                  value={form.unloadingHours}
                  onChange={(e) => set('unloadingHours', e.target.value)}
                  placeholder="10"
                />
              </Field>
              <Field label="Ship Speed" htmlFor="vs-speed" hint="knots" error={errors.speedKnots}>
                <input
                  id="vs-speed"
                  type="number"
                  step="0.5"
                  min="0"
                  className={inputClass}
                  value={form.speedKnots}
                  onChange={(e) => set('speedKnots', e.target.value)}
                  placeholder="14"
                />
              </Field>
              <Field
                label="Departure"
                htmlFor="vs-departure"
                hint="origin timestamp"
                error={errors.departure}
                className="sm:col-span-2"
              >
                <input
                  id="vs-departure"
                  type="datetime-local"
                  className={inputClass}
                  value={form.departure}
                  onChange={(e) => set('departure', e.target.value)}
                />
              </Field>
            </div>
          </Panel>
        </div>

        {/* ── Position & Spoilage ── */}
        <div className="grid gap-3 md:grid-cols-2">
          <Panel eyebrow="Section 05" title="Navigation Position" grid>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Latitude" htmlFor="vs-lat" hint="decimal °" error={errors.lat}>
                <input
                  id="vs-lat"
                  type="number"
                  step="0.01"
                  className={inputClass}
                  value={form.lat}
                  onChange={(e) => set('lat', e.target.value)}
                  placeholder="15.50"
                />
              </Field>
              <Field label="Longitude" htmlFor="vs-lon" hint="decimal °" error={errors.lon}>
                <input
                  id="vs-lon"
                  type="number"
                  step="0.01"
                  className={inputClass}
                  value={form.lon}
                  onChange={(e) => set('lon', e.target.value)}
                  placeholder="82.40"
                />
              </Field>
            </div>
            <p className="mt-3 font-mono text-[10px] text-mist">
              PORT REFERENCE {port.lat.toFixed(2)}° N / {port.lon.toFixed(2)}° E
              {activePort && (
                <span className="ml-2 text-aqua">({activePort.short})</span>
              )}
            </p>
            <p className="mt-1 font-mono text-[9px] text-mist/60">
              Operating window: {latMin}°–{latMax}° N · {lonMin}°–{lonMax}° E
            </p>
          </Panel>

          <Panel eyebrow="Section 06" title="Time-Sensitive Cargo" grid>
            <Field
              label="Spoilage Window"
              htmlFor="vs-spoil"
              hint="hours from departure"
              error={errors.spoilageWindowHours}
            >
              <input
                id="vs-spoil"
                type="number"
                min="0"
                disabled={!form.spoilable}
                className={cn(inputClass, !form.spoilable && 'opacity-45')}
                value={form.spoilageWindowHours}
                onChange={(e) => set('spoilageWindowHours', e.target.value)}
              />
            </Field>
            <p className="mt-3 font-mono text-[10px] text-mist">
              {form.spoilable
                ? `DEADLINE ${
                    preview.spoilageDeadline
                      ? `${fmtDate(preview.spoilageDeadline)} | ${fmtTime(preview.spoilageDeadline)}`
                      : '—'
                  }`
                : 'ENABLE SPOILABLE CARGO TO SET A DEADLINE CONSTRAINT'}
            </p>
          </Panel>
        </div>

        {/* ── Actions ── */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-deck/70 p-3 backdrop-blur">
          <Button
            type="submit"
            variant="primary"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            className="px-5"
            disabled={submitting}
          >
            {submitting ? 'Registering…' : 'Register Vessel'}
          </Button>
          <Button
            icon={<RotateCcwIcon className="h-3.5 w-3.5" />}
            onClick={() => {
              setForm(blankForm(nextId, now));
              setErrors({});
              toast('Console cleared');
            }}
          >
            Clear
          </Button>
          <Button
            icon={<SaveIcon className="h-3.5 w-3.5" />}
            onClick={() => {
              saveDraft({ ...candidate });
              toast.success('Draft saved locally');
            }}
          >
            Save Draft
          </Button>
          <Button
            variant="secondary"
            icon={<Trash2Icon className="h-3.5 w-3.5" />}
            className="ml-auto"
            disabled={clearing || vessels.length === 0}
            onClick={async () => {
              setClearing(true);
              try {
                await clearVessels();
                toast.success('All vessels cleared');
              } finally {
                setClearing(false);
              }
            }}
          >
            Clear All
          </Button>
          <p className="font-mono text-[10px] text-mist">
            {vessels.length} VESSELS IN REGISTER
          </p>
        </div>
      </form>

      {/* ── Right panel ── */}
      <div className="space-y-3">
        <Panel eyebrow="Auto-computed" title="Derived Voyage Plan">
          <dl>
            <DataRow
              label="Departure"
              value={
                form.departure
                  ? `${fmtDate(candidate.departure)} | ${fmtTime(candidate.departure)}`
                  : '—'
              }
            />
            <DataRow
              label="Distance to Port"
              value={`${fmtNumber(preview.distanceKm)} km`}
              tone="text-aqua"
            />
            <DataRow label="Travel Time" value={fmtDuration(preview.travelHours)} />
            <DataRow
              label="ETA"
              value={`${fmtDate(preview.eta)} | ${fmtTime(preview.eta)}`}
              tone="text-chalk"
            />
            <DataRow
              label="Expected End"
              value={`${fmtDate(preview.expectedEnd)} | ${fmtTime(preview.expectedEnd)}`}
            />
            <DataRow
              label="Spoilage Deadline"
              value={
                preview.spoilageDeadline
                  ? `${fmtDate(preview.spoilageDeadline)} | ${fmtTime(preview.spoilageDeadline)}`
                  : 'N/A'
              }
              tone={preview.spoilageRisk === 'breach' ? 'text-crit' : 'text-chalk'}
            />
            <DataRow
              label="Cargo Priority"
              value={preview.priority.toUpperCase()}
              tone={
                preview.priority === 'critical'
                  ? 'text-crit'
                  : preview.priority === 'high'
                  ? 'text-warn'
                  : 'text-mist'
              }
            />
          </dl>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-mist/80">
            Values computed locally as you type; the backend re-derives them on registration.
          </p>
        </Panel>

        <Panel eyebrow="Reference" title="Console Guide">
          <ul className="space-y-2.5">
            {[
              { Icon: ShipIcon, text: 'Identity keys the vessel across berth, crane and analytics views.' },
              { Icon: PackageIcon, text: 'Cargo profile sets throughput and spoilage constraints.' },
              { Icon: RulerIcon, text: 'Dimensions are matched against berth LOA and draft limits.' },
              { Icon: SettingsIcon, text: 'Unloading time defines berth occupancy in the plan.' },
              { Icon: NavigationIcon, text: 'Position feeds distance, ETA and the live map track.' },
              { Icon: TimerIcon, text: 'Spoilage window escalates the vessel in the solver objective.' },
            ].map(({ Icon, text }) => (
              <li key={text} className="flex gap-2.5">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aqua/80" aria-hidden />
                <span className="text-[12px] leading-snug text-mist">{text}</span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* ── Vessel list with remove ── */}
        {vessels.length > 0 && (
          <Panel
            eyebrow={`${vessels.length} registered`}
            title="Current Vessels"
            bodyClassName="p-0"
          >
            <ul className="max-h-64 divide-y divide-line/70 overflow-y-auto">
              {vessels.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12px] text-chalk">{v.id}</span>
                    <span className="block font-mono text-[10px] text-mist">
                      {v.operator} · {v.cargoType}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2Icon className="h-3 w-3" />}
                    onClick={async () => {
                      try {
                        await removeVessel(v.id);
                        toast(`${v.id} removed`);
                      } catch {
                        toast.error(`Failed to remove ${v.id}`);
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* ── Drafts ── */}
        {drafts.length > 0 && (
          <Panel eyebrow={`${drafts.length} saved`} title="Drafts" bodyClassName="p-0">
            <ul className="divide-y divide-line/70">
              {drafts.map((draft, i) => (
                <li key={`${draft.id}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12px] text-chalk">{draft.id}</span>
                    <span className="block font-mono text-[10px] text-mist">
                      {draft.operator} · {draft.cargoType}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      setForm({
                        id: draft.id ?? nextId,
                        operator: draft.operator ?? '',
                        cargoType: (draft.cargoType as CargoType) ?? 'Containers',
                        loadTonnes: String(draft.loadTonnes ?? ''),
                        teu: String(draft.teu ?? ''),
                        spoilable: Boolean(draft.spoilable),
                        spoilageWindowHours: String(draft.spoilageWindowHours ?? '24'),
                        loa: String(draft.loa ?? ''),
                        draft: String(draft.draft ?? ''),
                        unloadingHours: String(draft.unloadingHours ?? ''),
                        speedKnots: String(draft.speedKnots ?? ''),
                        lat: String(draft.lat ?? ''),
                        lon: String(draft.lon ?? ''),
                        departure: toLocalInput(new Date(draft.departure ?? now)),
                      });
                      toast('Draft loaded into console');
                    }}
                  >
                    Load
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeDraft(i)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
