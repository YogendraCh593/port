/**
 * useSimulation – requestAnimationFrame ship animation engine.
 *
 * KEY DESIGN
 * ──────────
 * • The rAF tick() reads ONLY refs — it is created ONCE and never recreated.
 *   This is the most important rule. Recreating tick() breaks the loop.
 * • Simulation time advances: realDelta × SIM_SCALE × speed
 *   SIM_SCALE = 720  →  1 real hour = 5 real seconds at speed 1×
 * • Berth profiles are fetched async and stored in a ref. The tick reads
 *   the ref directly — no dependency on state.
 * • Ships interpolate smoothly from origin → port along a straight line.
 *   Position is recomputed every frame from the sim clock.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL } from '../services/api';

// ─── Constants ───────────────────────────────────────────────────────────────
export const SIM_SCALE = 720; // 1 real hour = 5 seconds at 1×

// ─── Public types ─────────────────────────────────────────────────────────────
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
  progress: number;   // 0–1 along approach track
  berthSlot: number;  // -1 = not at a berth
  berthName: string;
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

// ─── Internal schedule event ──────────────────────────────────────────────────
interface BerthEvent {
  vesselId: string;
  berthSlot: number;
  berthName: string;
  serviceStart: number; // ms
  serviceEnd: number;   // ms
  compatible: boolean;
}

// ─── Colour ───────────────────────────────────────────────────────────────────
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map(c =>
    Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}
export function shipColor(idx: number): string {
  return hsvToHex((idx * 137.508) % 360, 0.72, 0.95);
}

// ─── Haversine ────────────────────────────────────────────────────────────────
function haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371.0088;
  const dLat = (la2 - la1) * Math.PI / 180;
  const dLon = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Geometry ─────────────────────────────────────────────────────────────────
export function berthSlotPos(portLat: number, portLon: number, slot: number, total: number): [number, number] {
  const SEA  = 0.30, SPACE = 0.12, R = 6371.0;
  const along = slot * SPACE - ((total - 1) / 2) * SPACE;
  const dLat  = along / R * (180 / Math.PI);
  const dLon  = SEA / (R * Math.cos(portLat * Math.PI / 180)) * (180 / Math.PI);
  return [portLat + dLat, portLon + dLon];
}

function anchoragePos(portLat: number, portLon: number, idx: number): [number, number] {
  const DIST = 1.2, SPREAD = 0.18, R = 6371.0;
  const along = (idx % 4 - 1.5) * SPREAD;
  const back  = Math.floor(idx / 4) * SPREAD;
  const dLat  = along / R * (180 / Math.PI);
  const dLon  = (DIST + back) / (R * Math.cos(portLat * Math.PI / 180)) * (180 / Math.PI);
  return [portLat + dLat, portLon + dLon];
}

// ─── Cargo compatibility ──────────────────────────────────────────────────────
const CARGO_MAP: Record<string, string> = {
  containers: 'container', container: 'container',
  bulk: 'dry bulk', 'dry bulk': 'dry bulk',
  liquid: 'liquid bulk', 'liquid bulk': 'liquid bulk',
  reefer: 'container', roro: 'general cargo',
  general: 'general cargo', 'general cargo': 'general cargo',
  'project cargo': 'project cargo',
};

function compatible(v: SimVessel, b: BerthProfile): boolean {
  if (v.loadTonnes > b.capacity_tonnes) return false;
  if (v.loa        > b.max_loa_m)       return false;
  if (v.draft      > b.max_draft_m)     return false;
  const cat     = CARGO_MAP[v.cargoType.toLowerCase()] ?? 'general cargo';
  const allowed = b.cargo_types.map(c => c.toLowerCase());
  return allowed.includes(cat) || allowed.includes('general cargo');
}

// ─── Berth scheduler ──────────────────────────────────────────────────────────
function scheduleBerths(
  vessels: SimVessel[],
  profiles: BerthProfile[],
  portLat: number, portLon: number,
  halts: Record<string, { hours: number; reason: string }>,
): Map<string, BerthEvent> {
  const out = new Map<string, BerthEvent>();
  if (!vessels.length || !profiles.length) return out;

  const infos = vessels.map(v => {
    const dep    = new Date(v.departure).getTime();
    const dist   = haversineKm(v.lat, v.lon, portLat, portLon);
    const travel = dist / (Math.max(v.speedKnots, 0.1) * 1.852) * 3_600_000;
    const halt   = (halts[v.id]?.hours ?? 0) * 3_600_000;
    return { v, etaMs: dep + travel + halt, unloadMs: v.unloadingHours * 3_600_000 };
  }).sort((a, b) => a.etaMs - b.etaMs);

  const freeAt = new Array(profiles.length).fill(0);

  for (const { v, etaMs, unloadMs } of infos) {
    const compatibleSlots = profiles
      .map((bp, i) => ({ i, bp }))
      .filter(({ bp }) => compatible(v, bp));

    if (!compatibleSlots.length) {
      out.set(v.id, { vesselId: v.id, berthSlot: -1, berthName: 'No compatible berth', serviceStart: etaMs, serviceEnd: etaMs, compatible: false });
      continue;
    }

    // Pick compatible berth that's free earliest
    let best = compatibleSlots[0];
    for (const c of compatibleSlots) {
      if (freeAt[c.i] < freeAt[best.i]) best = c;
    }

    const start = Math.max(etaMs, freeAt[best.i]);
    const end   = start + unloadMs;
    freeAt[best.i] = end;

    out.set(v.id, {
      vesselId: v.id, berthSlot: best.i, berthName: profiles[best.i].name,
      serviceStart: start, serviceEnd: end, compatible: true,
    });
  }
  return out;
}

// ─── Schedule table builder ───────────────────────────────────────────────────
function makeScheduleTable(
  vessels: SimVessel[],
  sched: Map<string, BerthEvent>,
  portLat: number, portLon: number,
): ScheduleEntry[] {
  return vessels.map(v => {
    const ev      = sched.get(v.id);
    const dep     = new Date(v.departure).getTime();
    const dist    = haversineKm(v.lat, v.lon, portLat, portLon);
    const travel  = dist / (Math.max(v.speedKnots, 0.1) * 1.852) * 3_600_000;
    const etaMs   = dep + travel;
    const wait    = ev?.compatible ? Math.max(0, (ev.serviceStart - etaMs) / 3_600_000) : 0;
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
      waitHours:    wait,
      compatible:   ev?.compatible  ?? false,
    };
  }).sort((a, b) => a.serviceStart.getTime() - b.serviceStart.getTime());
}

// ─── Position interpolator (pure function — called every rAF tick) ────────────
function interpolateAll(
  tMs: number,
  vessels: SimVessel[],
  halts: Record<string, { hours: number; reason: string }>,
  sched: Map<string, BerthEvent>,
  profiles: BerthProfile[],
  portLat: number, portLon: number,
): {
  positions: ShipPosition[];
  berthState: { slot: number; occupied: boolean; shipId: string | null; berthName: string }[];
} {
  const nbTotal = profiles.length || 1;

  // Sort vessels by scheduled serviceStart for stable anchorage ordering
  const sorted = [...vessels].sort((a, b) => {
    const ea = sched.get(a.id)?.serviceStart ?? 0;
    const eb = sched.get(b.id)?.serviceStart ?? 0;
    return ea - eb;
  });

  let waitIdx = 0;
  const positions: ShipPosition[] = sorted.map(v => {
    const idx   = vessels.indexOf(v);
    const color = shipColor(idx);
    const ev    = sched.get(v.id);

    const dep    = new Date(v.departure).getTime();
    const dist   = haversineKm(v.lat, v.lon, portLat, portLon);
    const travel = dist / (Math.max(v.speedKnots, 0.1) * 1.852) * 3_600_000;
    const halt   = (halts[v.id]?.hours ?? 0) * 3_600_000;
    const rawEta = dep + travel + halt;

    const sStart   = ev?.serviceStart ?? rawEta;
    const sEnd     = ev?.serviceEnd   ?? (rawEta + v.unloadingHours * 3_600_000);
    const bSlot    = ev?.berthSlot    ?? -1;
    const bName    = ev?.berthName    ?? 'Unscheduled';
    const compat   = ev?.compatible   ?? false;

    let lat: number, lon: number;
    let status: ShipPosition['status'];
    let progress: number;
    let activeBerthSlot = -1;

    if (tMs <= dep) {
      // ── Pre-departure: sit at registered position ──
      lat = v.lat; lon = v.lon;
      status = 'Approaching'; progress = 0;

    } else if (tMs < rawEta) {
      // ── Approaching: smooth linear interpolation toward port ──
      const ratio = Math.min(1, (tMs - dep) / Math.max(travel, 1));
      progress = ratio;
      lat = v.lat + (portLat - v.lat) * ratio;
      lon = v.lon + (portLon - v.lon) * ratio;
      status = halts[v.id] ? 'Waiting at Anchorage' : 'Approaching';

    } else if (!compat || tMs < sStart) {
      // ── Arrived but waiting (no berth or berth busy) ──
      const [aLat, aLon] = anchoragePos(portLat, portLon, waitIdx++);
      lat = aLat; lon = aLon;
      status = 'Waiting at Anchorage'; progress = 1;

    } else if (tMs < sEnd) {
      // ── Servicing at berth ──
      const [bLat, bLon] = berthSlotPos(portLat, portLon, bSlot, nbTotal);
      lat = bLat; lon = bLon;
      status = 'Servicing'; progress = 1;
      activeBerthSlot = bSlot;

    } else {
      // ── Departed: sail back toward origin ──
      const elapsed     = (tMs - sEnd) / 3_600_000;
      const departDist  = Math.max(v.speedKnots, 0.1) * 1.852 * elapsed;
      const departRatio = Math.min(departDist / Math.max(dist, 1), 1);
      lat = portLat + (v.lat - portLat) * departRatio * 0.5;
      lon = portLon + (v.lon - portLon) * departRatio * 0.5;
      status = 'Departed'; progress = 1;
    }

    return {
      ship_id: v.id, lat, lon, status, progress, color, index: idx,
      speed_knots: v.speedKnots,
      eta: new Date(rawEta).toISOString(),
      cargo_type: v.cargoType, weight_tonnes: v.loadTonnes,
      operator: v.operator, loa_m: v.loa, draft_m: v.draft,
      halted: !!halts[v.id],
      halt_hours:  halts[v.id]?.hours  ?? 0,
      halt_reason: halts[v.id]?.reason ?? '',
      berthSlot: activeBerthSlot,
      berthName: bName,
    };
  });

  // Build live berthState
  const occupied  = new Set<number>();
  const shipAtBerth = new Map<number, string>();
  positions.forEach(p => {
    if (p.status === 'Servicing' && p.berthSlot >= 0) {
      occupied.add(p.berthSlot);
      shipAtBerth.set(p.berthSlot, p.ship_id);
    }
  });
  const berthState = profiles.map((bp, s) => ({
    slot:      s,
    berthName: bp.name,
    occupied:  occupied.has(s),
    shipId:    shipAtBerth.get(s) ?? null,
  }));

  return { positions, berthState };
}

// ─── The hook ─────────────────────────────────────────────────────────────────
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
  // ── All mutable state lives in refs so tick() never needs to be recreated ──
  const simRef      = useRef<number>(Date.now());          // sim clock in ms
  const speedRef    = useRef<number>(1);
  const playingRef  = useRef<boolean>(false);
  const lastRealRef = useRef<number>(performance.now());
  const vessels_ref = useRef<SimVessel[]>(vessels);
  const halts_ref   = useRef<Record<string, { hours: number; reason: string }>>({});
  const sched_ref   = useRef<Map<string, BerthEvent>>(new Map());
  const prof_ref    = useRef<BerthProfile[]>([]);
  const raf_ref     = useRef<number | null>(null);

  // React state — only for triggering re-renders
  const [simTime,    setSimTime]    = useState<Date>(new Date());
  const [playing,    setPlaying]    = useState<boolean>(false);
  const [speed,      setSpeedState] = useState<number>(1);
  const [positions,  setPositions]  = useState<ShipPosition[]>([]);
  const [berthState, setBerthState] = useState<{ slot: number; occupied: boolean; shipId: string | null; berthName: string }[]>([]);
  const [schedule,   setSchedule]   = useState<ScheduleEntry[]>([]);
  const [halts,      setHalts]      = useState<Record<string, { hours: number; reason: string }>>({});

  // Keep vessel ref in sync
  useEffect(() => { vessels_ref.current = vessels; }, [vessels]);
  useEffect(() => { halts_ref.current   = halts;   }, [halts]);

  // ── Fetch berth profiles once (and whenever port changes) ─────────────────
  useEffect(() => {
    fetch(`${BASE_URL}/berths/limits`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.berths) && data.berths.length > 0) {
          prof_ref.current = data.berths as BerthProfile[];
          // Rebuild schedule with real profiles
          sched_ref.current = scheduleBerths(
            vessels_ref.current, prof_ref.current, portLat, portLon, halts_ref.current,
          );
          setSchedule(makeScheduleTable(vessels_ref.current, sched_ref.current, portLat, portLon));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portLat, portLon]);

  // ── Rebuild schedule whenever vessels or halts change ─────────────────────
  const rebuildSchedule = useCallback(() => {
    const profiles = prof_ref.current.length > 0
      ? prof_ref.current
      : Array.from({ length: numBerths }, (_, i) => ({
          name: `Berth ${i + 1}`,
          capacity_tonnes: 999_999, max_loa_m: 999, max_draft_m: 99,
          cargo_types: ['container', 'dry bulk', 'liquid bulk', 'general cargo', 'project cargo'],
        }));
    sched_ref.current = scheduleBerths(
      vessels_ref.current, profiles, portLat, portLon, halts_ref.current,
    );
    setSchedule(makeScheduleTable(vessels_ref.current, sched_ref.current, portLat, portLon));
  }, [portLat, portLon, numBerths]);

  useEffect(() => {
    rebuildSchedule();
    // Reset sim clock to 10 minutes before earliest departure
    if (vessels.length > 0) {
      const t0 = Math.min(...vessels.map(v => new Date(v.departure).getTime())) - 10 * 60 * 1000;
      simRef.current = t0;
      setSimTime(new Date(t0));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vessels.length]);

  useEffect(() => { rebuildSchedule(); }, [halts, rebuildSchedule]);

  // ── Single stable rAF tick — NEVER recreated ──────────────────────────────
  // Reads everything from refs so zero deps are needed.
  const tick = useCallback((): void => {
    const now      = performance.now();
    const realMs   = now - lastRealRef.current;
    lastRealRef.current = now;

    // Advance sim clock
    simRef.current += realMs * SIM_SCALE * speedRef.current;

    // Resolve profiles (fallback if not yet loaded)
    const profiles = prof_ref.current.length > 0
      ? prof_ref.current
      : Array.from({ length: numBerths }, (_, i) => ({
          name: `Berth ${i + 1}`,
          capacity_tonnes: 999_999, max_loa_m: 999, max_draft_m: 99,
          cargo_types: ['container', 'dry bulk', 'liquid bulk', 'general cargo', 'project cargo'],
        }));

    const { positions: pos, berthState: bs } = interpolateAll(
      simRef.current,
      vessels_ref.current,
      halts_ref.current,
      sched_ref.current,
      profiles,
      portLat, portLon,
    );

    setSimTime(new Date(simRef.current));
    setPositions(pos);
    setBerthState(bs);

    if (playingRef.current) {
      raf_ref.current = requestAnimationFrame(tick);
    }
  // ← MUST be empty dep array — tick reads all state from refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Controls ──────────────────────────────────────────────────────────────
  const play = useCallback((): void => {
    if (playingRef.current) return;
    playingRef.current = true;
    lastRealRef.current = performance.now();
    setPlaying(true);
    raf_ref.current = requestAnimationFrame(tick);
  }, [tick]);

  const pause = useCallback((): void => {
    playingRef.current = false;
    setPlaying(false);
    if (raf_ref.current !== null) {
      cancelAnimationFrame(raf_ref.current);
      raf_ref.current = null;
    }
  }, []);

  const reset = useCallback((): void => {
    pause();
    const vs = vessels_ref.current;
    const t0 = vs.length > 0
      ? Math.min(...vs.map(v => new Date(v.departure).getTime())) - 10 * 60 * 1000
      : Date.now();
    simRef.current = t0;
    setSimTime(new Date(t0));

    const profiles = prof_ref.current.length > 0 ? prof_ref.current : [];
    const { positions: pos, berthState: bs } = interpolateAll(
      t0, vs, halts_ref.current, sched_ref.current, profiles, portLat, portLon,
    );
    setPositions(pos);
    setBerthState(bs);
  }, [pause, portLat, portLon]);

  const setSpeed = useCallback((s: number): void => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      playingRef.current = false;
      if (raf_ref.current !== null) cancelAnimationFrame(raf_ref.current);
    };
  }, []);

  // ── Emergency halt ────────────────────────────────────────────────────────
  const applyHalt = useCallback(async (shipId: string, haltHours: number, reason: string) => {
    setHalts(prev => ({ ...prev, [shipId]: { hours: (prev[shipId]?.hours ?? 0) + haltHours, reason } }));
    try {
      await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ship_id: shipId, halt_hours: haltHours, reason }),
      });
    } catch { /* silent */ }
  }, []);

  const clearHalt = useCallback(async (shipId: string) => {
    setHalts(prev => { const n = { ...prev }; delete n[shipId]; return n; });
    try {
      await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, { method: 'DELETE' });
    } catch { /* silent */ }
  }, []);

  return {
    simTime, playing, speed,
    positions, berthState, schedule,
    halts, play, pause, reset, setSpeed,
    applyHalt, clearHalt,
    numBerths: prof_ref.current.length || numBerths,
  };
}
