/**
 * useSimulation – rAF-driven ship animation with constraint-aware berth allocation.
 *
 * Berth scheduler rules (v2)
 * ──────────────────────────
 * 1. Fetch berth profiles from /berths/limits so we know each berth's
 *    capacity, max LOA, max draft and cargo types.
 * 2. For each ship, compute the set of COMPATIBLE berths (respecting all
 *    physical constraints).
 * 3. Among compatible berths, pick the one that becomes free earliest
 *    (FCFS). This spreads ships across ALL compatible berths — not just
 *    the one with the highest capacity.
 * 4. If no berth is compatible the ship waits at anchorage indefinitely
 *    (shown with amber ring).
 * 5. berthState[] is recomputed every rAF tick for live green/red colour.
 *
 * Time scaling: 1 real hour = 5 real seconds at speed 1× (SIM_SCALE = 720)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL } from '../services/api';

export const SIM_SCALE = 720;

// ── Types ────────────────────────────────────────────────────────────────────
export interface ShipPosition {
  ship_id: string;
  lat: number;
  lon: number;
  status: 'Approaching' | 'Waiting at Anchorage' | 'Servicing' | 'Departed';
  color: string;
  index: number;
  speed_knots: number;
  eta: string | null;
  cargo_type: string;
  weight_tonnes: number;
  operator: string;
  loa_m: number;
  draft_m: number;
  halted: boolean;
  halt_hours: number;
  halt_reason: string;
  progress: number;
  berthSlot: number;       // -1 = not at a berth
  berthName: string;       // display name of assigned berth
}

export interface SimVessel {
  id: string;
  lat: number;
  lon: number;
  speedKnots: number;
  departure: string;
  unloadingHours: number;
  cargoType: string;
  loadTonnes: number;
  operator: string;
  loa: number;
  draft: number;
  teu: number;
}

export interface BerthProfile {
  name: string;
  capacity_tonnes: number;
  max_loa_m: number;
  max_draft_m: number;
  cargo_types: string[];
}

interface BerthEvent {
  vesselId: string;
  berthSlot: number;
  berthName: string;
  serviceStart: number;
  serviceEnd: number;
  compatible: boolean;  // false → no berth found, ship waits forever
}

// ── Schedule entry exposed to UI ──────────────────────────────────────────────
export interface ScheduleEntry {
  vesselId: string;
  operator: string;
  cargoType: string;
  weightTonnes: number;
  loa: number;
  draft: number;
  berthName: string;
  berthSlot: number;
  serviceStart: Date;
  serviceEnd: Date;
  waitHours: number;
  compatible: boolean;
}

// ── Colour helpers ────────────────────────────────────────────────────────────
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)]
    .map(c => Math.round(c * 255).toString(16).padStart(2, '0'))
    .join('');
}
export function shipColor(idx: number): string {
  return hsvToHex((idx * 137.508) % 360, 0.72, 0.95);
}

// ── Haversine ─────────────────────────────────────────────────────────────────
function haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371.0088;
  const dLat = (la2 - la1) * Math.PI / 180;
  const dLon = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Cargo category mapping (matches backend) ──────────────────────────────────
const CARGO_CATEGORY: Record<string, string> = {
  containers: 'container', container: 'container',
  bulk: 'dry bulk', 'dry bulk': 'dry bulk',
  liquid: 'liquid bulk', 'liquid bulk': 'liquid bulk',
  reefer: 'container',
  roro: 'general cargo', 'general cargo': 'general cargo',
  general: 'general cargo',
  'project cargo': 'project cargo',
};

function cargoCategory(raw: string): string {
  return CARGO_CATEGORY[raw.toLowerCase()] ?? 'general cargo';
}

// ── Berth compatibility check ─────────────────────────────────────────────────
function isCompatible(vessel: SimVessel, berth: BerthProfile): boolean {
  if (vessel.loadTonnes > berth.capacity_tonnes) return false;
  if (vessel.loa   > berth.max_loa_m)   return false;
  if (vessel.draft > berth.max_draft_m)  return false;
  const cat     = cargoCategory(vessel.cargoType);
  const allowed = berth.cargo_types.map(c => c.toLowerCase());
  if (!allowed.includes(cat) && !allowed.includes('general cargo')) return false;
  return true;
}

// ── Geometry ──────────────────────────────────────────────────────────────────
export function berthSlotPos(
  portLat: number, portLon: number,
  slot: number, totalBerths: number,
): [number, number] {
  const SEA_OFFSET_KM  = 0.30;
  const BERTH_SPACE_KM = 0.12;
  const EARTH_R        = 6371.0;
  const halfSpan = ((totalBerths - 1) / 2) * BERTH_SPACE_KM;
  const along    = slot * BERTH_SPACE_KM - halfSpan;
  const dLat     = along / EARTH_R * (180 / Math.PI);
  const dLon     = SEA_OFFSET_KM / (EARTH_R * Math.cos(portLat * Math.PI / 180)) * (180 / Math.PI);
  return [portLat + dLat, portLon + dLon];
}

function anchorageSlotPos(portLat: number, portLon: number, waitIdx: number): [number, number] {
  const ANCHOR_DIST_KM = 1.2;
  const SPREAD_KM      = 0.18;
  const EARTH_R        = 6371.0;
  const col   = waitIdx % 4;
  const row   = Math.floor(waitIdx / 4);
  const along = (col - 1.5) * SPREAD_KM;
  const back  = row * SPREAD_KM;
  const dLat  = along / EARTH_R * (180 / Math.PI);
  const dLon  = (ANCHOR_DIST_KM + back) / (EARTH_R * Math.cos(portLat * Math.PI / 180)) * (180 / Math.PI);
  return [portLat + dLat, portLon + dLon];
}

// ── Constraint-aware berth scheduler ─────────────────────────────────────────
function scheduleBerths(
  vessels: SimVessel[],
  berthProfiles: BerthProfile[],
  portLat: number, portLon: number,
  halts: Record<string, { hours: number; reason: string }>,
): Map<string, BerthEvent> {
  const result = new Map<string, BerthEvent>();
  if (vessels.length === 0 || berthProfiles.length === 0) return result;

  const numBerths = berthProfiles.length;

  // Compute ETA for every vessel
  const infos = vessels.map(v => {
    const depMs    = new Date(v.departure).getTime();
    const distKm   = haversineKm(v.lat, v.lon, portLat, portLon);
    const speedKmh = Math.max(v.speedKnots, 0.1) * 1.852;
    const travelMs = distKm / speedKmh * 3_600_000;
    const haltMs   = (halts[v.id]?.hours ?? 0) * 3_600_000;
    return { v, etaMs: depMs + travelMs + haltMs, unloadMs: v.unloadingHours * 3_600_000 };
  });

  // Sort by ETA ascending
  const sorted = [...infos].sort((a, b) => a.etaMs - b.etaMs);

  // Track when each berth slot becomes free
  const berthFreeAt: number[] = Array(numBerths).fill(0);

  for (const info of sorted) {
    // Find compatible berths
    const compatible = berthProfiles
      .map((bp, slot) => ({ slot, bp }))
      .filter(({ bp }) => isCompatible(info.v, bp));

    if (compatible.length === 0) {
      // No compatible berth — record as incompatible, ship waits forever
      result.set(info.v.id, {
        vesselId: info.v.id, berthSlot: -1, berthName: 'No compatible berth',
        serviceStart: info.etaMs, serviceEnd: info.etaMs,
        compatible: false,
      });
      continue;
    }

    // Among compatible berths, pick the one free earliest
    let bestSlot = compatible[0].slot;
    let bestFree = berthFreeAt[compatible[0].slot];
    for (const { slot } of compatible) {
      if (berthFreeAt[slot] < bestFree) {
        bestFree = berthFreeAt[slot];
        bestSlot = slot;
      }
    }

    const serviceStart = Math.max(info.etaMs, berthFreeAt[bestSlot]);
    const serviceEnd   = serviceStart + info.unloadMs;
    berthFreeAt[bestSlot] = serviceEnd;

    result.set(info.v.id, {
      vesselId: info.v.id,
      berthSlot: bestSlot,
      berthName: berthProfiles[bestSlot].name,
      serviceStart, serviceEnd,
      compatible: true,
    });
  }
  return result;
}

// ── Build public schedule table ────────────────────────────────────────────────
function buildScheduleTable(
  vessels: SimVessel[],
  schedule: Map<string, BerthEvent>,
  portLat: number,
  portLon: number,
): ScheduleEntry[] {
  return vessels
    .map(v => {
      const ev = schedule.get(v.id);
      const depMs    = new Date(v.departure).getTime();
      const distKm   = haversineKm(v.lat, v.lon, portLat, portLon);
      const speedKmh = Math.max(v.speedKnots, 0.1) * 1.852;
      const travelMs = distKm / speedKmh * 3_600_000;
      const etaMs    = depMs + travelMs;
      const waitHours = ev?.compatible
        ? Math.max(0, (ev.serviceStart - etaMs) / 3_600_000)
        : 0;
      return {
        vesselId:     v.id,
        operator:     v.operator,
        cargoType:    v.cargoType,
        weightTonnes: v.loadTonnes,
        loa:          v.loa,
        draft:        v.draft,
        berthName:    ev?.berthName    ?? 'Unscheduled',
        berthSlot:    ev?.berthSlot    ?? -1,
        serviceStart: new Date(ev?.serviceStart ?? etaMs),
        serviceEnd:   new Date(ev?.serviceEnd   ?? etaMs),
        waitHours,
        compatible:   ev?.compatible ?? false,
      };
    })
    .sort((a, b) => a.serviceStart.getTime() - b.serviceStart.getTime());
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useSimulation({
  portLat,
  portLon,
  vessels,
  numBerths = 5,
}: {
  portLat: number;
  portLon: number;
  vessels: SimVessel[];
  numBerths?: number;
}) {
  // ── Berth profiles from API ───────────────────────────────────────────────
  const [berthProfiles, setBerthProfiles] = useState<BerthProfile[]>([]);
  useEffect(() => {
    fetch(`${BASE_URL}/berths/limits`)
      .then(r => r.json())
      .then(data => {
        if (data.berths && data.berths.length > 0) {
          setBerthProfiles(data.berths as BerthProfile[]);
        }
      })
      .catch(() => {});
  }, []);  // refetched on port change via key from parent

  // Fallback: generic profiles when API not yet loaded
  const effectiveProfiles = berthProfiles.length > 0
    ? berthProfiles
    : Array.from({ length: numBerths }, (_, i) => ({
        name: `Berth ${i + 1}`,
        capacity_tonnes: 999_999,
        max_loa_m: 999,
        max_draft_m: 99,
        cargo_types: ['container', 'dry bulk', 'liquid bulk', 'general cargo', 'project cargo'],
      }));

  function getInitialTime(vs: SimVessel[]): Date {
    if (vs.length === 0) return new Date();
    const earliest = Math.min(...vs.map(v => new Date(v.departure).getTime()));
    return new Date(earliest - 10 * 60 * 1000);
  }

  const [simTime,    setSimTime]    = useState<Date>(() => getInitialTime(vessels));
  const [playing,    setPlaying]    = useState(false);
  const [speed,      setSpeedState] = useState(1);
  const [positions,  setPositions]  = useState<ShipPosition[]>([]);
  const [berthState, setBerthState] = useState<{ slot: number; occupied: boolean; shipId: string | null; berthName: string }[]>([]);
  const [schedule,   setSchedule]   = useState<ScheduleEntry[]>([]);
  const [halts,      setHalts]      = useState<Record<string, { hours: number; reason: string }>>({});

  const rafRef      = useRef<number | null>(null);
  const lastRef     = useRef<number>(performance.now());
  const simRef      = useRef<Date>(simTime);
  const speedRef    = useRef<number>(speed);
  const haltsRef    = useRef(halts);
  const vesselsRef  = useRef(vessels);
  const profilesRef = useRef(effectiveProfiles);
  const scheduleRef = useRef<Map<string, BerthEvent>>(new Map());

  useEffect(() => { speedRef.current    = speed;            }, [speed]);
  useEffect(() => { haltsRef.current    = halts;            }, [halts]);
  useEffect(() => { vesselsRef.current  = vessels;          }, [vessels]);
  useEffect(() => { profilesRef.current = effectiveProfiles; }, [effectiveProfiles]);

  // ── Recompute schedule whenever vessels, halts or berth profiles change ────
  function recompute(vs: SimVessel[], h: typeof halts, profiles: BerthProfile[]) {
    const map = scheduleBerths(vs, profiles, portLat, portLon, h);
    scheduleRef.current = map;
    setSchedule(buildScheduleTable(vs, map, portLat, portLon));
    return map;
  }

  useEffect(() => {
    const map = recompute(vessels, halts, effectiveProfiles);
    // Reset sim clock when vessel count changes
    if (vessels.length > 0) {
      const earliest = Math.min(...vessels.map(v => new Date(v.departure).getTime()));
      const t = new Date(earliest - 10 * 60 * 1000);
      simRef.current = t;
      setSimTime(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vessels.length, portLat, portLon, berthProfiles.length]);

  useEffect(() => {
    recompute(vesselsRef.current, halts, profilesRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halts]);

  // ── Core position interpolator ─────────────────────────────────────────────
  function interpolate(
    t: Date,
    vs: SimVessel[],
    h: typeof halts,
    sched: Map<string, BerthEvent>,
    profiles: BerthProfile[],
  ): { positions: ShipPosition[]; berthState: typeof berthState } {
    const tMs = t.getTime();
    const nbTotal = profiles.length || numBerths;

    // Sort by scheduled serviceStart for stable anchorage slot assignment
    const sortedIds = [...vs]
      .sort((a, b) => {
        const ea = sched.get(a.id)?.serviceStart ?? 0;
        const eb = sched.get(b.id)?.serviceStart ?? 0;
        return ea - eb;
      })
      .map(v => v.id);

    let waitingSlot = 0;

    const posList: ShipPosition[] = sortedIds.map(id => {
      const v      = vs.find(x => x.id === id)!;
      const idx    = vs.indexOf(v);
      const color  = shipColor(idx);
      const ev     = sched.get(v.id);

      const depMs    = new Date(v.departure).getTime();
      const distKm   = haversineKm(v.lat, v.lon, portLat, portLon);
      const speedKmh = Math.max(v.speedKnots, 0.1) * 1.852;
      const travelMs = distKm / speedKmh * 3_600_000;
      const haltMs   = (h[v.id]?.hours ?? 0) * 3_600_000;
      const rawEtaMs = depMs + travelMs + haltMs;

      const serviceStart = ev?.serviceStart ?? rawEtaMs;
      const serviceEnd   = ev?.serviceEnd   ?? (rawEtaMs + v.unloadingHours * 3_600_000);
      const berthSlot    = ev?.berthSlot    ?? -1;
      const berthName    = ev?.berthName    ?? 'Unscheduled';
      const compatible   = ev?.compatible   ?? false;

      let lat: number, lon: number;
      let status: ShipPosition['status'];
      let progress: number;
      let activeBerthSlot = -1;

      if (tMs <= depMs) {
        lat = v.lat; lon = v.lon;
        status = 'Approaching'; progress = 0;

      } else if (tMs < rawEtaMs) {
        const ratio = Math.min(1, (tMs - depMs) / Math.max(travelMs, 1));
        progress = ratio;
        lat = v.lat + (portLat - v.lat) * ratio;
        lon = v.lon + (portLon - v.lon) * ratio;
        status = h[v.id] ? 'Waiting at Anchorage' : 'Approaching';

      } else if (!compatible || tMs < serviceStart) {
        // Arrived but no compatible berth OR berth not yet free
        const [aLat, aLon] = anchorageSlotPos(portLat, portLon, waitingSlot++);
        lat = aLat; lon = aLon;
        status = 'Waiting at Anchorage'; progress = 1;

      } else if (tMs < serviceEnd) {
        const [bLat, bLon] = berthSlotPos(portLat, portLon, berthSlot, nbTotal);
        lat = bLat; lon = bLon;
        status = 'Servicing'; progress = 1;
        activeBerthSlot = berthSlot;

      } else {
        const departedHours = (tMs - serviceEnd) / 3_600_000;
        const departDist    = Math.max(v.speedKnots, 0.1) * 1.852 * departedHours;
        const departRatio   = Math.min(departDist / Math.max(distKm, 1), 1);
        lat = portLat + (v.lat - portLat) * departRatio * 0.5;
        lon = portLon + (v.lon - portLon) * departRatio * 0.5;
        status = 'Departed'; progress = 1;
      }

      return {
        ship_id: v.id, lat, lon, status, progress, color, index: idx,
        speed_knots: v.speedKnots,
        eta: new Date(rawEtaMs).toISOString(),
        cargo_type: v.cargoType,
        weight_tonnes: v.loadTonnes,
        operator: v.operator,
        loa_m: v.loa, draft_m: v.draft,
        halted: !!h[v.id],
        halt_hours:  h[v.id]?.hours  ?? 0,
        halt_reason: h[v.id]?.reason ?? '',
        berthSlot: activeBerthSlot,
        berthName,
      };
    });

    // Compute live berthState
    const occupied = new Set<number>();
    const berthShipMap = new Map<number, string>();
    posList.forEach(p => {
      if (p.status === 'Servicing' && p.berthSlot >= 0) {
        occupied.add(p.berthSlot);
        berthShipMap.set(p.berthSlot, p.ship_id);
      }
    });
    const berthSt = profiles.map((bp, s) => ({
      slot:      s,
      berthName: bp.name,
      occupied:  occupied.has(s),
      shipId:    berthShipMap.get(s) ?? null,
    }));

    return { positions: posList, berthState: berthSt };
  }

  // ── Stable rAF tick ─────────────────────────────────────────────────────────
  const tick = useCallback(() => {
    const now       = performance.now();
    const realDelta = now - lastRef.current;
    lastRef.current = now;

    const simDelta = realDelta * SIM_SCALE * speedRef.current;
    const nextSim  = new Date(simRef.current.getTime() + simDelta);
    simRef.current = nextSim;

    const result = interpolate(
      nextSim,
      vesselsRef.current,
      haltsRef.current,
      scheduleRef.current,
      profilesRef.current,
    );
    setSimTime(new Date(nextSim));
    setPositions(result.positions);
    setBerthState(result.berthState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portLat, portLon, numBerths]);

  useEffect(() => {
    if (playing) {
      lastRef.current = performance.now();
      rafRef.current  = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    }
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [playing, tick]);

  useEffect(() => {
    if (!playing) {
      const r = interpolate(simRef.current, vessels, halts, scheduleRef.current, effectiveProfiles);
      setPositions(r.positions);
      setBerthState(r.berthState);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halts, vessels, playing, berthProfiles]);

  const play  = useCallback(() => { lastRef.current = performance.now(); setPlaying(true); }, []);
  const pause = useCallback(() => setPlaying(false), []);

  const reset = useCallback(() => {
    setPlaying(false);
    const vs = vesselsRef.current;
    const t  = vs.length > 0
      ? new Date(Math.min(...vs.map(v => new Date(v.departure).getTime())) - 10 * 60 * 1000)
      : new Date();
    simRef.current = t;
    setSimTime(t);
    const r = interpolate(t, vs, haltsRef.current, scheduleRef.current, profilesRef.current);
    setPositions(r.positions);
    setBerthState(r.berthState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portLat, portLon, numBerths]);

  const setSpeed = useCallback((s: number) => { speedRef.current = s; setSpeedState(s); }, []);

  const applyHalt = useCallback(async (shipId: string, haltHours: number, reason: string) => {
    setHalts(prev => ({ ...prev, [shipId]: { hours: (prev[shipId]?.hours ?? 0) + haltHours, reason } }));
    try {
      await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ship_id: shipId, halt_hours: haltHours, reason }),
      });
    } catch (e) { console.warn('Backend halt sync failed:', e); }
  }, []);

  const clearHalt = useCallback(async (shipId: string) => {
    setHalts(prev => { const n = { ...prev }; delete n[shipId]; return n; });
    try {
      await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, { method: 'DELETE' });
    } catch (e) { console.warn('Backend halt clear failed:', e); }
  }, []);

  return {
    simTime, playing, speed,
    positions, berthState, schedule,
    halts, play, pause, reset, setSpeed,
    applyHalt, clearHalt,
    numBerths: effectiveProfiles.length || numBerths,
  };
}
