/**
 * VesselRegistrationConsole
 * ─────────────────────────
 * • Live coordinate validation against Bay of Bengal / Indian Ocean ocean-only window
 * • Real-time berth capacity check as user types
 * • Emergency halt button per registered vessel (extends ETA, shown in simulation)
 * • Berth load capacity shown as a coloured bar for each compatible berth
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  PlusIcon, RotateCcwIcon, SaveIcon, ShipIcon, PackageIcon,
  RulerIcon, SettingsIcon, NavigationIcon, TimerIcon,
  TriangleAlertIcon, CheckCircle2Icon, Trash2Icon,
  AlertOctagonIcon, XCircleIcon, MapPinIcon, AnchorIcon,
} from 'lucide-react';
import { usePort } from '../../contexts/PortContext';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { DataRow } from '../ui/DataRow';
import { ProgressBar } from '../ui/ProgressBar';
import { cn, inputClass } from '../../utils/ui';
import { deriveVessel, fmtDate, fmtDuration, fmtNumber, fmtTime } from '../../utils/geo';
import { BASE_URL } from '../../services/api';
import type { CargoType, Vessel } from '../../types';

const cargoTypes: CargoType[] = ['Containers', 'Bulk', 'Liquid', 'Reefer', 'RoRo', 'General'];

// ── Bay of Bengal / Indian Ocean ocean window ────────────────────────────────
const SEA_LAT_MIN = -10, SEA_LAT_MAX = 22;
const SEA_LON_MIN = 75,  SEA_LON_MAX = 100;

// Simplified land bounding boxes to keep ships at sea
const LAND_BOXES = [
  { latMin: 8.0,  latMax: 23.5, lonMin: 72.5, lonMax: 80.0,  name: 'Mainland India' },
  { latMin: 5.9,  latMax: 9.9,  lonMin: 79.6, lonMax: 81.9,  name: 'Sri Lanka' },
  { latMin: 20.5, latMax: 24.0, lonMin: 88.0, lonMax: 93.0,  name: 'Bangladesh / Myanmar' },
];

function isOcean(lat: number, lon: number): { valid: boolean; reason: string } {
  if (lat < SEA_LAT_MIN || lat > SEA_LAT_MAX || lon < SEA_LON_MIN || lon > SEA_LON_MAX)
    return { valid: false, reason: `Outside Bay of Bengal window (${SEA_LAT_MIN}–${SEA_LAT_MAX}°N, ${SEA_LON_MIN}–${SEA_LON_MAX}°E)` };
  for (const b of LAND_BOXES)
    if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax)
      return { valid: false, reason: `Coordinate appears to be on land (${b.name}) — move offshore` };
  return { valid: true, reason: '' };
}

interface FormState {
  id: string; operator: string; cargoType: CargoType;
  loadTonnes: string; teu: string;
  spoilable: boolean; spoilageWindowHours: string;
  loa: string; draft: string;
  unloadingHours: string; speedKnots: string;
  lat: string; lon: string; departure: string;
}

const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

function blankForm(nextId: string, now: Date): FormState {
  return {
    id: nextId, operator: '', cargoType: 'Containers',
    loadTonnes: '', teu: '', spoilable: false, spoilageWindowHours: '24',
    loa: '', draft: '', unloadingHours: '', speedKnots: '',
    lat: '', lon: '', departure: toLocalInput(now),
  };
}

interface BerthCheck {
  berth: string; compatible: boolean; reasons: string[];
  berth_capacity_t: number; load_pct: number;
  max_loa_m: number; max_draft_m: number; cargo_types: string[];
}

interface HaltModalState {
  shipId: string; shipLabel: string;
}

export function VesselRegistrationConsole() {
  const {
    vessels, addVessel, removeVessel, clearVessels,
    berths, port, now, drafts, saveDraft, removeDraft, activePort,
  } = usePort();

  const nextId = useMemo(() => {
    const nums = vessels.map((v) => Number(v.id.replace(/[^0-9]/g, ''))).filter(Number.isFinite);
    return `SHP-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  }, [vessels]);

  const [form, setForm] = useState<FormState>(() => blankForm(nextId, now));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Berth capacity check (debounced)
  const [berthCheck, setBerthCheck] = useState<BerthCheck[] | null>(null);
  const checkTimer = useRef<number | null>(null);

  // Halt modal
  const [haltModal, setHaltModal] = useState<HaltModalState | null>(null);
  const [haltHours, setHaltHours] = useState('2');
  const [haltReason, setHaltReason] = useState('Emergency halt requested by operator');
  const [halting, setHalting] = useState(false);
  // Track which vessels are halted locally
  const [haltedVessels, setHaltedVessels] = useState<Record<string, { hours: number; reason: string }>>({});

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

  // ── Live berth capacity check ──────────────────────────────────────────
  useEffect(() => {
    if (checkTimer.current) window.clearTimeout(checkTimer.current);
    const weight = num(form.loadTonnes);
    const loa = num(form.loa);
    const draft = num(form.draft);
    if (!(weight > 0) || !(loa > 0) || !(draft > 0)) { setBerthCheck(null); return; }
    checkTimer.current = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          weight_tonnes: String(weight),
          loa_m: String(loa),
          draft_m: String(draft),
          cargo_type: form.cargoType,
        });
        const res = await fetch(`${BASE_URL}/berths/capacity-check?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        setBerthCheck([...data.compatible_berths, ...data.incompatible_berths]);
      } catch { /* ignore */ }
    }, 600);
    return () => { if (checkTimer.current) window.clearTimeout(checkTimer.current); };
  }, [form.loadTonnes, form.loa, form.draft, form.cargoType]);

  // ── Coordinate validation ──────────────────────────────────────────────
  const latNum = num(form.lat);
  const lonNum = num(form.lon);
  const coordCheck = useMemo(() => {
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;
    return isOcean(latNum, lonNum);
  }, [latNum, lonNum]);

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
    lat: Number.isFinite(latNum) ? latNum : port.lat,
    lon: Number.isFinite(lonNum) ? lonNum : port.lon,
    departure: new Date(form.departure || now).toISOString(),
    spoilable: form.spoilable,
    spoilageWindowHours: form.spoilable ? num(form.spoilageWindowHours) || 0 : 0,
    status: 'approaching',
  };
  const preview = deriveVessel(candidate, port);

  // Quick check against local berth data
  const feasibleBerths = berths.filter(
    (b) => b.status === 'operational' && candidate.loa <= b.maxLoa && candidate.draft <= b.maxDraft,
  );

  // ── Validation ────────────────────────────────────────────────────────
  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.id.trim()) next.id = 'Ship ID required';
    else if (vessels.some((v) => v.id.toLowerCase() === form.id.trim().toLowerCase()))
      next.id = 'Ship ID already registered';
    if (!form.operator.trim()) next.operator = 'Operator required';
    if (!(num(form.loadTonnes) > 0)) next.loadTonnes = 'Load must be > 0';
    if (!(num(form.loa) > 0)) next.loa = 'LOA required';
    if (!(num(form.draft) > 0)) next.draft = 'Draft required';
    if (!(num(form.unloadingHours) > 0)) next.unloadingHours = 'Unloading time required';
    if (!(num(form.speedKnots) > 0)) next.speedKnots = 'Speed required';
    if (!Number.isFinite(latNum)) next.lat = 'Latitude required';
    else if (!coordCheck?.valid) next.lat = coordCheck?.reason ?? 'Invalid position';
    if (!Number.isFinite(lonNum)) next.lon = 'Longitude required';
    if (form.spoilable && !(num(form.spoilageWindowHours) > 0))
      next.spoilageWindowHours = 'Spoilage window required';
    if (!form.departure) next.departure = 'Departure timestamp required';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) { toast.error('Fix highlighted fields'); return; }
    setSubmitting(true);
    try {
      await addVessel(candidate);
      toast.success(`${candidate.id} registered`, {
        description: `ETA ${fmtDate(preview.eta)} ${fmtTime(preview.eta)} · ${fmtNumber(preview.distanceKm)} km`,
      });
      const newNum = (Number(candidate.id.replace(/[^0-9]/g, '')) || vessels.length) + 1;
      setForm(blankForm(`SHP-${String(newNum).padStart(3, '0')}`, now));
      setErrors({});
      setBerthCheck(null);
    } catch (err: unknown) {
      toast.error('Registration failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Emergency halt ─────────────────────────────────────────────────────
  async function confirmHalt() {
    if (!haltModal) return;
    setHalting(true);
    try {
      const res = await fetch(`${BASE_URL}/vessels/${encodeURIComponent(haltModal.shipId)}/emergency-halt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ship_id: haltModal.shipId, halt_hours: Number(haltHours), reason: haltReason }),
      });
      if (!res.ok) throw new Error(await res.text());
      setHaltedVessels((prev) => ({
        ...prev,
        [haltModal.shipId]: { hours: (prev[haltModal.shipId]?.hours ?? 0) + Number(haltHours), reason: haltReason },
      }));
      toast.error(`EMERGENCY HALT — ${haltModal.shipId}`, {
        description: `ETA extended by ${haltHours}h. Reason: ${haltReason}`,
      });
      setHaltModal(null);
    } catch (err) {
      toast.error('Halt failed', { description: String(err) });
    } finally {
      setHalting(false);
    }
  }

  async function clearHalt(shipId: string) {
    try {
      await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, { method: 'DELETE' });
      setHaltedVessels((prev) => { const n = { ...prev }; delete n[shipId]; return n; });
      toast.success(`Halt cleared for ${shipId}`);
    } catch {
      toast.error('Failed to clear halt');
    }
  }

  return (
    <>
    {/* ── Emergency Halt Modal ── */}
    {haltModal && (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(4,7,14,0.85)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#0A1120', border: '1px solid rgba(239,68,68,0.5)',
          borderRadius: 16, padding: 28, maxWidth: 440, width: '90%',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}>
          <div className="flex items-center gap-3 mb-4">
            <AlertOctagonIcon className="h-6 w-6 text-crit" />
            <h2 className="font-display text-lg font-bold text-chalk uppercase tracking-wider">
              Emergency Halt
            </h2>
          </div>
          <p className="font-mono text-[12px] text-mist mb-4">
            Vessel: <span className="text-crit font-bold">{haltModal.shipLabel}</span><br />
            This will extend the vessel's ETA by the specified hours and hold it at anchorage.
          </p>
          <div className="space-y-3">
            <Field label="Halt Duration (hours)" htmlFor="halt-hours">
              <input id="halt-hours" type="number" min="0.5" step="0.5"
                className={inputClass} value={haltHours}
                onChange={(e) => setHaltHours(e.target.value)} />
            </Field>
            <Field label="Reason" htmlFor="halt-reason">
              <input id="halt-reason" className={inputClass} value={haltReason}
                onChange={(e) => setHaltReason(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2 mt-5">
            <Button variant="primary" icon={<AlertOctagonIcon className="h-3.5 w-3.5" />}
              className="flex-1 bg-crit/90 hover:bg-crit border-crit/60"
              onClick={confirmHalt} disabled={halting}>
              {halting ? 'Applying…' : 'Apply Halt'}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setHaltModal(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    )}

    <div className="grid gap-3 xl:grid-cols-3">
      <form onSubmit={submit} className="space-y-3 xl:col-span-2">

        {/* ── Identity ── */}
        <Panel eyebrow="Section 01" title="Vessel Identity" grid>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ship ID" htmlFor="vs-id" hint={`suggested ${nextId}`} error={errors.id}>
              <input id="vs-id" className={inputClass} value={form.id}
                onChange={(e) => set('id', e.target.value.toUpperCase())} placeholder="SHP-013" />
            </Field>
            <Field label="Operator" htmlFor="vs-operator" error={errors.operator}>
              <input id="vs-operator" className={inputClass} value={form.operator}
                onChange={(e) => set('operator', e.target.value)} placeholder="Maersk" />
            </Field>
          </div>
        </Panel>

        {/* ── Cargo ── */}
        <Panel eyebrow="Section 02" title="Cargo Profile" grid>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Cargo Type" htmlFor="vs-cargo">
              <select id="vs-cargo" className={inputClass} value={form.cargoType}
                onChange={(e) => set('cargoType', e.target.value as CargoType)}>
                {cargoTypes.map((c) => <option key={c} value={c} className="bg-abyss">{c}</option>)}
              </select>
            </Field>
            <Field label="Load Weight" htmlFor="vs-load" hint="tonnes" error={errors.loadTonnes}>
              <input id="vs-load" type="number" min="0" className={inputClass}
                value={form.loadTonnes} onChange={(e) => set('loadTonnes', e.target.value)} placeholder="5000" />
            </Field>
            <Field label="TEU" htmlFor="vs-teu" hint="containers">
              <input id="vs-teu" type="number" min="0" className={inputClass}
                value={form.teu} onChange={(e) => set('teu', e.target.value)} placeholder="2500" />
            </Field>
          </div>
          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-abyss/60 px-3 py-2.5 transition-colors hover:border-edge">
            <input type="checkbox" className="h-4 w-4 rounded border-edge bg-abyss text-aqua focus:ring-aqua"
              checked={form.spoilable} onChange={(e) => set('spoilable', e.target.checked)} />
            <span>
              <span className="block font-display text-[11px] font-semibold uppercase tracking-wider text-chalk">Spoilable Cargo</span>
              <span className="block font-mono text-[10px] text-mist">Enables spoilage deadline constraint in berth allocation</span>
            </span>
          </label>
        </Panel>

        {/* ── Dimensions & Operational ── */}
        <div className="grid gap-3 md:grid-cols-2">
          <Panel eyebrow="Section 03" title="Vessel Dimensions" grid>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="LOA" htmlFor="vs-loa" hint="metres" error={errors.loa}>
                <input id="vs-loa" type="number" min="0" className={inputClass}
                  value={form.loa} onChange={(e) => set('loa', e.target.value)} placeholder="280" />
              </Field>
              <Field label="Draft" htmlFor="vs-draft" hint="metres" error={errors.draft}>
                <input id="vs-draft" type="number" step="0.1" min="0" className={inputClass}
                  value={form.draft} onChange={(e) => set('draft', e.target.value)} placeholder="12" />
              </Field>
            </div>
            {/* Berth compatibility quick check */}
            {candidate.loa > 0 && candidate.draft > 0 && (
              <p className={cn('mt-3 flex items-center gap-2 font-mono text-[10px]',
                feasibleBerths.length ? 'text-ok' : 'text-crit')}>
                {feasibleBerths.length
                  ? <><CheckCircle2Icon className="h-3.5 w-3.5" />{`FITS ${feasibleBerths.map((b) => b.id).join(' · ')}`}</>
                  : <><TriangleAlertIcon className="h-3.5 w-3.5" />NO OPERATIONAL BERTH ACCEPTS THESE DIMENSIONS</>}
              </p>
            )}
          </Panel>

          <Panel eyebrow="Section 04" title="Operational Parameters" grid>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Unloading Time" htmlFor="vs-unload" hint="hours" error={errors.unloadingHours}>
                <input id="vs-unload" type="number" step="0.5" min="0" className={inputClass}
                  value={form.unloadingHours} onChange={(e) => set('unloadingHours', e.target.value)} placeholder="10" />
              </Field>
              <Field label="Ship Speed" htmlFor="vs-speed" hint="knots" error={errors.speedKnots}>
                <input id="vs-speed" type="number" step="0.5" min="0" className={inputClass}
                  value={form.speedKnots} onChange={(e) => set('speedKnots', e.target.value)} placeholder="14" />
              </Field>
              <Field label="Departure" htmlFor="vs-departure" hint="timestamp" error={errors.departure} className="sm:col-span-2">
                <input id="vs-departure" type="datetime-local" className={inputClass}
                  value={form.departure} onChange={(e) => set('departure', e.target.value)} />
              </Field>
            </div>
          </Panel>
        </div>

        {/* ── Position ── */}
        <div className="grid gap-3 md:grid-cols-2">
          <Panel eyebrow="Section 05" title="Navigation Position (Bay of Bengal / Indian Ocean)" grid>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Latitude" htmlFor="vs-lat" hint="decimal °" error={errors.lat}>
                <input id="vs-lat" type="number" step="0.01" className={inputClass}
                  value={form.lat} onChange={(e) => set('lat', e.target.value)} placeholder="15.50" />
              </Field>
              <Field label="Longitude" htmlFor="vs-lon" hint="decimal °" error={errors.lon}>
                <input id="vs-lon" type="number" step="0.01" className={inputClass}
                  value={form.lon} onChange={(e) => set('lon', e.target.value)} placeholder="85.00" />
              </Field>
            </div>

            {/* Live ocean / land check */}
            {coordCheck && (
              <div className={cn('mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 font-mono text-[10px]',
                coordCheck.valid
                  ? 'border-ok/30 bg-ok/[0.07] text-ok'
                  : 'border-crit/30 bg-crit/[0.07] text-crit')}>
                {coordCheck.valid
                  ? <><CheckCircle2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />VALID OCEAN POSITION — BAY OF BENGAL</>
                  : <><TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />{coordCheck.reason}</>}
              </div>
            )}
            <p className="mt-2 font-mono text-[9px] text-mist/60">
              Port: {port.lat.toFixed(3)}°N / {port.lon.toFixed(3)}°E
              {activePort && <span className="ml-2 text-aqua">({activePort.short})</span>}
              &nbsp;· Window: {SEA_LAT_MIN}–{SEA_LAT_MAX}°N · {SEA_LON_MIN}–{SEA_LON_MAX}°E
            </p>
          </Panel>

          <Panel eyebrow="Section 06" title="Time-Sensitive Cargo" grid>
            <Field label="Spoilage Window" htmlFor="vs-spoil" hint="hours from departure" error={errors.spoilageWindowHours}>
              <input id="vs-spoil" type="number" min="0"
                disabled={!form.spoilable} className={cn(inputClass, !form.spoilable && 'opacity-45')}
                value={form.spoilageWindowHours} onChange={(e) => set('spoilageWindowHours', e.target.value)} />
            </Field>
            <p className="mt-3 font-mono text-[10px] text-mist">
              {form.spoilable && preview.spoilageDeadline
                ? `DEADLINE ${fmtDate(preview.spoilageDeadline)} | ${fmtTime(preview.spoilageDeadline)}`
                : 'Enable spoilable cargo to set a deadline constraint'}
            </p>
          </Panel>
        </div>

        {/* ── Berth load capacity check panel ── */}
        {berthCheck && berthCheck.length > 0 && (
          <Panel eyebrow="Live check" title="Berth Load Capacity Analysis" grid>
            <p className="mb-3 font-mono text-[10px] text-mist">
              Showing compatibility for {fmtNumber(num(form.loadTonnes))} t · LOA {form.loa} m · Draft {form.draft} m
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {berthCheck.map((b) => (
                <div key={b.berth} className={cn(
                  'rounded-lg border p-3',
                  b.compatible ? 'border-ok/30 bg-ok/[0.05]' : 'border-crit/20 bg-crit/[0.04]',
                )}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold text-chalk">{b.berth}</span>
                    {b.compatible
                      ? <CheckCircle2Icon className="h-3.5 w-3.5 text-ok" />
                      : <XCircleIcon className="h-3.5 w-3.5 text-crit" />}
                  </div>
                  <p className="mt-1 font-mono text-[9px] text-mist">
                    Cap: {b.berth_capacity_t.toLocaleString()} t · LOA ≤{b.max_loa_m} m · Draft ≤{b.max_draft_m} m
                  </p>
                  <div className="mt-2">
                    <div className="mb-1 flex justify-between font-mono text-[9px]">
                      <span className="text-mist">LOAD FILL</span>
                      <span className={b.load_pct > 100 ? 'text-crit' : b.load_pct > 80 ? 'text-warn' : 'text-ok'}>
                        {b.load_pct}%
                      </span>
                    </div>
                    <ProgressBar
                      value={Math.min(b.load_pct, 100)}
                      tone={b.load_pct > 100 ? 'bg-crit' : b.load_pct > 80 ? 'bg-warn' : 'bg-ok'}
                    />
                  </div>
                  {!b.compatible && b.reasons.length > 0 && (
                    <p className="mt-1.5 font-mono text-[9px] text-crit/80">{b.reasons.join(' · ')}</p>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── Actions ── */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-deck/70 p-3 backdrop-blur">
          <Button type="submit" variant="primary" icon={<PlusIcon className="h-3.5 w-3.5" />}
            className="px-5" disabled={submitting}>
            {submitting ? 'Registering…' : 'Register Vessel'}
          </Button>
          <Button icon={<RotateCcwIcon className="h-3.5 w-3.5" />}
            onClick={() => { setForm(blankForm(nextId, now)); setErrors({}); setBerthCheck(null); toast('Console cleared'); }}>
            Clear
          </Button>
          <Button icon={<SaveIcon className="h-3.5 w-3.5" />}
            onClick={() => { saveDraft({ ...candidate }); toast.success('Draft saved'); }}>
            Save Draft
          </Button>
          <Button variant="secondary" icon={<Trash2Icon className="h-3.5 w-3.5" />} className="ml-auto"
            disabled={clearing || vessels.length === 0}
            onClick={async () => {
              setClearing(true);
              try { await clearVessels(); toast.success('All vessels cleared'); }
              finally { setClearing(false); }
            }}>
            Clear All
          </Button>
          <p className="font-mono text-[10px] text-mist">{vessels.length} VESSELS IN REGISTER</p>
        </div>
      </form>

      {/* ── Right panel ── */}
      <div className="space-y-3">
        {/* Voyage plan preview */}
        <Panel eyebrow="Auto-computed" title="Derived Voyage Plan">
          <dl>
            <DataRow label="Departure"
              value={form.departure ? `${fmtDate(candidate.departure)} | ${fmtTime(candidate.departure)}` : '—'} />
            <DataRow label="Distance to Port" value={`${fmtNumber(preview.distanceKm)} km`} tone="text-aqua" />
            <DataRow label="Travel Time" value={fmtDuration(preview.travelHours)} />
            <DataRow label="ETA" value={`${fmtDate(preview.eta)} | ${fmtTime(preview.eta)}`} tone="text-chalk" />
            <DataRow label="Expected End" value={`${fmtDate(preview.expectedEnd)} | ${fmtTime(preview.expectedEnd)}`} />
            <DataRow label="Sim Travel Time"
              value={preview.travelHours > 0 ? `~${(preview.travelHours * 3600 / 720).toFixed(1)}s at 1×` : '—'}
              tone="text-aqua" />
            <DataRow label="Spoilage Deadline"
              value={preview.spoilageDeadline ? `${fmtDate(preview.spoilageDeadline)} | ${fmtTime(preview.spoilageDeadline)}` : 'N/A'}
              tone={preview.spoilageRisk === 'breach' ? 'text-crit' : 'text-chalk'} />
          </dl>
          <p className="mt-3 font-mono text-[10px] text-mist/70">
            Simulation: 1 real hour = 5 seconds at speed 1× (720× scale)
          </p>
        </Panel>

        {/* Guide */}
        <Panel eyebrow="Reference" title="Console Guide">
          <ul className="space-y-2.5">
            {[
              { Icon: ShipIcon,      text: 'Ships must be in the Bay of Bengal / Indian Ocean — not on land.' },
              { Icon: MapPinIcon,    text: 'Coordinates validated against land bounding boxes in real time.' },
              { Icon: PackageIcon,   text: 'Berth capacity check shows load fill % for each berth as you type.' },
              { Icon: RulerIcon,     text: 'LOA and draft are matched against berth physical limits.' },
              { Icon: TimerIcon,     text: 'Spoilage window escalates the vessel in the QUBO optimizer.' },
              { Icon: AlertOctagonIcon, text: 'Emergency halt extends ETA and holds the ship at anchorage.' },
            ].map(({ Icon, text }) => (
              <li key={text} className="flex gap-2.5">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aqua/80" aria-hidden />
                <span className="text-[12px] leading-snug text-mist">{text}</span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Vessel list with halt controls */}
        {vessels.length > 0 && (
          <Panel eyebrow={`${vessels.length} registered`} title="Vessels — Halt Controls" bodyClassName="p-0">
            <ul className="max-h-80 divide-y divide-line/70 overflow-y-auto">
              {vessels.map((v) => {
                const halted = haltedVessels[v.id];
                return (
                  <li key={v.id} className={cn(
                    'px-4 py-3 transition-colors',
                    halted && 'bg-crit/[0.05]',
                  )}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[12px] font-bold text-chalk">{v.id}</span>
                          {halted && (
                            <span className="flex items-center gap-1 rounded border border-crit/40 bg-crit/10 px-1.5 py-0.5 font-mono text-[9px] text-crit">
                              <AlertOctagonIcon className="h-2.5 w-2.5" />
                              HALTED +{halted.hours}h
                            </span>
                          )}
                        </span>
                        <span className="block font-mono text-[10px] text-mist">{v.operator} · {v.cargoType}</span>
                        {halted && <span className="block font-mono text-[9px] text-crit/70">{halted.reason}</span>}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {halted ? (
                          <Button size="sm" variant="ghost"
                            icon={<XCircleIcon className="h-3 w-3 text-ok" />}
                            onClick={() => clearHalt(v.id)}>
                            Clear
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost"
                            icon={<AlertOctagonIcon className="h-3 w-3 text-crit" />}
                            onClick={() => {
                              setHaltModal({ shipId: v.id, shipLabel: `${v.id} – ${v.operator}` });
                              setHaltHours('2');
                              setHaltReason('Emergency halt requested by operator');
                            }}>
                            Halt
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" icon={<Trash2Icon className="h-3 w-3" />}
                          onClick={async () => {
                            try { await removeVessel(v.id); toast(`${v.id} removed`); }
                            catch { toast.error(`Failed to remove ${v.id}`); }
                          }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}

        {/* Drafts */}
        {drafts.length > 0 && (
          <Panel eyebrow={`${drafts.length} saved`} title="Drafts" bodyClassName="p-0">
            <ul className="divide-y divide-line/70">
              {drafts.map((draft, i) => (
                <li key={`${draft.id}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12px] text-chalk">{draft.id}</span>
                    <span className="block font-mono text-[10px] text-mist">{draft.operator} · {draft.cargoType}</span>
                  </span>
                  <Button size="sm" onClick={() => {
                    setForm({
                      id: draft.id ?? nextId, operator: draft.operator ?? '',
                      cargoType: (draft.cargoType as CargoType) ?? 'Containers',
                      loadTonnes: String(draft.loadTonnes ?? ''), teu: String(draft.teu ?? ''),
                      spoilable: Boolean(draft.spoilable),
                      spoilageWindowHours: String(draft.spoilageWindowHours ?? '24'),
                      loa: String(draft.loa ?? ''), draft: String(draft.draft ?? ''),
                      unloadingHours: String(draft.unloadingHours ?? ''),
                      speedKnots: String(draft.speedKnots ?? ''),
                      lat: String(draft.lat ?? ''), lon: String(draft.lon ?? ''),
                      departure: toLocalInput(new Date(draft.departure ?? now)),
                    });
                    toast('Draft loaded');
                  }}>Load</Button>
                  <Button size="sm" variant="ghost" onClick={() => removeDraft(i)}>Delete</Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
    </>
  );
}
