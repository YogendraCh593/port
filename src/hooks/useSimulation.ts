/**
 * useSimulation – rAF-driven ship animation with proper berth allocation.
 *
 * Berth scheduler rules
 * ─────────────────────
 * 1. Ships are sorted by ETA (earliest first).
 * 2. When a ship arrives it takes the first FREE berth.
 * 3. If no berth is free, the ship waits at the anchorage zone offshore.
 * 4. When a servicing ship departs, its berth is freed and the next
 *    waiting ship immediately moves into it.
 * 5. Berth state is recomputed every rAF tick so colour changes happen
 *    the instant a ship departs.
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
  /** Which berth slot (0-based) this ship is assigned to, or -1 if waiting */
  berthSlot: number;
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

/** What the scheduler computed for each ship */
interface BerthEvent {
  vesselId: string;
  berthSlot: number;   // which physical berth (0-based)
  serviceStart: number; // ms – when ship actually enters the berth
  serviceEnd: number;   // ms – when ship departs
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

// ── Geometry helpers ──────────────────────────────────────────────────────────

/**
 * Place berths in a compact arc just offshore of the port.
 * Up to `totalBerths` slots, spread so each berth is clearly separate.
 */
function berthSlotPos(
  portLat: number, portLon: number,
  slot: number, totalBerths: number,
): { lat: number; lon: number } {
  // Fan berths along a 1.5 km arc due-east (sea side), 0.3 km offshore
  const SEA_OFFSET_KM  = 0.30;
  const BERTH_SPACE_KM = 0.12;
  const EARTH_R        = 6371.0;

  const halfSpan = ((totalBerths - 1) / 2) * BERTH_SPACE_KM;
  const along    = slot * BERTH_SPACE_KM - halfSpan;

  // East offset = offshore, north offset = along the jetty line
  const dLat = along / EARTH_R * (180 / Math.PI);
  const dLon = SEA_OFFSET_KM / (EARTH_R * Math.cos(portLat * Math.PI / 180)) * (180 / Math.PI);

  return { lat: portLat + dLat, lon: portLon + dLon };
}

/**
 * Place waiting ships in a fan-shaped anchorage zone further offshore.
 * Each waiting ship gets a unique spot so they don't overlap.
 */
function anchorageSlotPos(
  portLat: number, portLon: number,
  waitIdx: number,   // 0-based index among currently-waiting ships
): { lat: number; lon: number } {
  const ANCHOR_DIST_KM = 1.2;  // further offshore than berths
  const SPREAD_KM      = 0.18;
  const EARTH_R        = 6371.0;

  const col   = waitIdx % 4;
  const row   = Math.floor(waitIdx / 4);
  const along = (col - 1.5) * SPREAD_KM;
  const back  = row * SPREAD_KM;

  const dLat = along / EARTH_R * (180 / Math.PI);
  const dLon = (ANCHOR_DIST_KM + back) / (EARTH_R * Math.cos(portLat * Math.PI / 180)) * (180 / Math.PI);

  return { lat: portLat + dLat, lon: portLon + dLon };
}

// ── Berth scheduler ───────────────────────────────────────────────────────────
/**
 * Pure function — computes the full berth allocation schedule for all ships.
 * Ships are sorted by ETA. Each ship takes the first berth that becomes free.
 * If all berths are full the ship waits (its serviceStart is pushed to when
 * the first berth becomes available).
 *
 * Returns a map: vesselId → BerthEvent
 */
function scheduleBerths(
  vessels: SimVessel[],
  numBerths: number,
  portLat: number, portLon: number,
  halts: Record<string, { hours: number; reason: string }>,
): Map<string, BerthEvent> {
  const result = new Map<string, BerthEvent>();
  if (vessels.length === 0 || numBerths === 0) return result;

  // Compute each ship's base ETA
  interface ShipInfo {
    v: SimVessel;
    etaMs: number;
    unloadMs: number;
  }
  const infos: ShipInfo[] = vessels.map(v => {
    const depMs    = new Date(v.departure).getTime();
    const distKm   = haversineKm(v.lat, v.lon, portLat, portLon);
    const speedKmh = Math.max(v.speedKnots, 0.1) * 1.852;
    const travelMs = distKm / speedKmh * 3_600_000;
    const haltMs   = (halts[v.id]?.hours ?? 0) * 3_600_000;
    return {
      v,
      etaMs:    depMs + travelMs + haltMs,
      unloadMs: v.unloadingHours * 3_600_000,
    };
  });

  // Sort by ETA ascending
  const sorted = [...infos].sort((a, b) => a.etaMs - b.etaMs);

  // Track when each berth slot becomes free (ms)
  const berthFreeAt: number[] = Array.from({ length: numBerths }, () => 0);

  for (const info of sorted) {
    // Find the berth that becomes free earliest
    let bestSlot = 0;
    let bestFree = berthFreeAt[0];
    for (let s = 1; s < numBerths; s++) {
      if (berthFreeAt[s] < bestFree) {
        bestFree = berthFreeAt[s];
        bestSlot = s;
      }
    }
    // Ship starts service when BOTH it arrives AND the berth is free
    const serviceStart = Math.max(info.etaMs, berthFreeAt[bestSlot]);
    const serviceEnd   = serviceStart + info.unloadMs;
    berthFreeAt[bestSlot] = serviceEnd;

    result.set(info.v.id, {
      vesselId:     info.v.id,
      berthSlot:    bestSlot,
      serviceStart,
      serviceEnd,
    });
  }
  return result;
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
  function getInitialTime(vs: SimVessel[]): Date {
    if (vs.length === 0) return new Date();
    const earliest = Math.min(...vs.map(v => new Date(v.departure).getTime()));
    return new Date(earliest - 10 * 60 * 1000);
  }

  const [simTime,   setSimTime]   = useState<Date>(() => getInitialTime(vessels));
  const [playing,   setPlaying]   = useState(false);
  const [speed,     setSpeedState]= useState(1);
  const [positions, setPositions] = useState<ShipPosition[]>([]);
  const [berthState, setBerthState] = useState<{
    slot: number; occupied: boolean; shipId: string | null
  }[]>([]);
  const [halts, setHalts] = useState<Record<string, { hours: number; reason: string }>>({});

  // Refs — no stale closures in tick()
  const rafRef      = useRef<number | null>(null);
  const lastRef     = useRef<number>(performance.now());
  const simRef      = useRef<Date>(simTime);
  const speedRef    = useRef<number>(speed);
  const haltsRef    = useRef(halts);
  const vesselsRef  = useRef(vessels);
  const scheduleRef = useRef<Map<string, BerthEvent>>(new Map());

  useEffect(() => { speedRef.current  = speed;   }, [speed]);
  useEffect(() => { haltsRef.current  = halts;   }, [halts]);
  useEffect(() => { vesselsRef.current = vessels; }, [vessels]);

  // Recompute full schedule whenever vessels or halts change
  useEffect(() => {
    scheduleRef.current = scheduleBerths(
      vessels, numBerths, portLat, portLon, halts,
    );
    // Also reset sim clock to before earliest departure
    if (vessels.length > 0) {
      const earliest = Math.min(...vessels.map(v => new Date(v.departure).getTime()));
      const t = new Date(earliest - 10 * 60 * 1000);
      simRef.current = t;
      setSimTime(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vessels.length, numBerths, portLat, portLon]);

  // Re-schedule when halts change (ETA changes)
  useEffect(() => {
    scheduleRef.current = scheduleBerths(
      vesselsRef.current, numBerths, portLat, portLon, halts,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halts]);

  // ── Core interpolator ───────────────────────────────────────────────────────
  function interpolate(
    t: Date,
    vs: SimVessel[],
    h: typeof halts,
    schedule: Map<string, BerthEvent>,
  ): { positions: ShipPosition[]; berthState: typeof berthState } {
    const tMs = t.getTime();

    // Count how many ships are currently waiting (for anchorage slot assignment)
    // We process in ETA order so waiting index is stable
    const sortedIds = vs
      .map((v, idx) => {
        const ev = schedule.get(v.id);
        return { id: v.id, idx, etaMs: ev?.serviceStart ?? 0 };
      })
      .sort((a, b) => a.etaMs - b.etaMs)
      .map(x => x.id);

    let waitingSlot = 0;

    const posList: ShipPosition[] = sortedIds.map(id => {
      const v    = vs.find(x => x.id === id)!;
      const idx  = vs.indexOf(v);
      const ev   = schedule.get(v.id);
      const color = shipColor(idx);

      const depMs   = new Date(v.departure).getTime();
      const distKm  = haversineKm(v.lat, v.lon, portLat, portLon);
      const speedKmh = Math.max(v.speedKnots, 0.1) * 1.852;
      const travelMs = distKm / speedKmh * 3_600_000;
      const haltMs   = (h[v.id]?.hours ?? 0) * 3_600_000;
      const rawEtaMs = depMs + travelMs + haltMs;

      // Scheduler may have pushed start later if berth was busy
      const serviceStart = ev?.serviceStart ?? rawEtaMs;
      const serviceEnd   = ev?.serviceEnd   ?? (serviceStart + v.unloadingHours * 3_600_000);
      const berthSlot    = ev?.berthSlot    ?? 0;

      let lat: number, lon: number;
      let status: ShipPosition['status'];
      let progress: number;

      if (tMs <= depMs) {
        // Not yet departed — sit at origin
        ({ lat, lon } = { lat: v.lat, lon: v.lon });
        status   = 'Approaching';
        progress = 0;

      } else if (tMs < rawEtaMs) {
        // On approach — smooth linear interpolation
        const ratio = Math.min(1, (tMs - depMs) / Math.max(travelMs, 1));
        progress = ratio;
        lat = v.lat + (portLat - v.lat) * ratio;
        lon = v.lon + (portLon - v.lon) * ratio;
        status = h[v.id] ? 'Waiting at Anchorage' : 'Approaching';

      } else if (tMs < serviceStart) {
        // Arrived but berth is busy — wait at anchorage
        const aPos = anchorageSlotPos(portLat, portLon, waitingSlot++);
        lat = aPos.lat; lon = aPos.lon;
        status   = 'Waiting at Anchorage';
        progress = 1;

      } else if (tMs < serviceEnd) {
        // In berth — servicing
        const bPos = berthSlotPos(portLat, portLon, berthSlot, numBerths);
        lat = bPos.lat; lon = bPos.lon;
        status   = 'Servicing';
        progress = 1;

      } else {
        // Departed — sail back toward origin
        const departedMs    = tMs - serviceEnd;
        const departedHours = departedMs / 3_600_000;
        const departDist    = Math.max(v.speedKnots, 0.1) * 1.852 * departedHours;
        const departRatio   = Math.min(departDist / Math.max(distKm, 1), 1);
        lat = portLat + (v.lat - portLat) * departRatio * 0.5;
        lon = portLon + (v.lon - portLon) * departRatio * 0.5;
        status   = 'Departed';
        progress = 1;
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
        berthSlot: status === 'Servicing' ? berthSlot : -1,
      };
    });

    // Compute which berth slots are currently occupied
    const occupied = new Set<number>();
    posList.forEach(p => { if (p.status === 'Servicing') occupied.add(p.berthSlot); });
    const berthSt = Array.from({ length: numBerths }, (_, s) => ({
      slot: s,
      occupied: occupied.has(s),
      shipId: posList.find(p => p.status === 'Servicing' && p.berthSlot === s)?.ship_id ?? null,
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
    );
    setSimTime(new Date(nextSim));
    setPositions(result.positions);
    setBerthState(result.berthState);

    rafRef.current = requestAnimationFrame(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portLat, portLon, numBerths]);

  // Start / stop rAF
  useEffect(() => {
    if (playing) {
      lastRef.current = performance.now();
      rafRef.current  = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    }
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [playing, tick]);

  // Re-render when paused
  useEffect(() => {
    if (!playing) {
      const r = interpolate(simRef.current, vessels, halts, scheduleRef.current);
      setPositions(r.positions);
      setBerthState(r.berthState);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halts, vessels, playing]);

  // ── Controls ─────────────────────────────────────────────────────────────────
  const play  = useCallback(() => { lastRef.current = performance.now(); setPlaying(true);  }, []);
  const pause = useCallback(() => setPlaying(false), []);

  const reset = useCallback(() => {
    setPlaying(false);
    const vs = vesselsRef.current;
    const t  = vs.length > 0
      ? new Date(Math.min(...vs.map(v => new Date(v.departure).getTime())) - 10 * 60 * 1000)
      : new Date();
    simRef.current = t;
    setSimTime(t);
    const r = interpolate(t, vs, haltsRef.current, scheduleRef.current);
    setPositions(r.positions);
    setBerthState(r.berthState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portLat, portLon, numBerths]);

  const setSpeed = useCallback((s: number) => { speedRef.current = s; setSpeedState(s); }, []);

  // ── Emergency halt ────────────────────────────────────────────────────────────
  const applyHalt = useCallback(async (shipId: string, haltHours: number, reason: string) => {
    setHalts(prev => ({ ...prev, [shipId]: { hours: (prev[shipId]?.hours ?? 0) + haltHours, reason } }));
    try {
      await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    positions, berthState,
    halts, play, pause, reset, setSpeed,
    applyHalt, clearHalt,
    numBerths,
  };
}
