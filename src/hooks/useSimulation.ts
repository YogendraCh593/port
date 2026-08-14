/**
 * useSimulation – rAF-driven ship animation engine.
 *
 * Time scaling: 1 real hour = 5 real seconds at speed 1×
 *   → SIM_SCALE = 720  (sim-seconds per real-second)
 *
 * FIX LOG
 * ───────
 * • speed stored in a ref so tick() never gets recreated (was causing rAF
 *   to restart every speed change and never accumulate movement)
 * • simTime initialised to (departure - 10 min) so ships are always seen
 *   moving from the start
 * • Servicing berth position is deterministic (no Math.random jitter)
 * • tick() closure is stable — only recreated when vessels/port change
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL } from '../services/api';

export const SIM_SCALE = 720; // 1 real hr = 5 real seconds at 1×

export interface ShipPosition {
  ship_id: string;
  lat: number;
  lon: number;
  status: 'Approaching' | 'At Port' | 'Waiting at Anchorage' | 'Servicing' | 'Departed';
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
  progress: number; // 0–1 along approach track
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

// ── Helpers ─────────────────────────────────────────────────────────────────
function haversineKm(la1: number, lo1: number, la2: number, lo2: number) {
  const R = 6371.0088;
  const dLat = ((la2 - la1) * Math.PI) / 180;
  const dLon = ((lo2 - lo1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((la1 * Math.PI) / 180) *
      Math.cos((la2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return (
    '#' +
    [f(5), f(3), f(1)]
      .map((c) => Math.round(c * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

export function shipColor(idx: number) {
  return hsvToHex((idx * 137.508) % 360, 0.72, 0.95);
}

/** Deterministic anchorage offset so ships don't jitter at anchorage */
function anchoragePos(pLat: number, pLon: number, idx: number) {
  const ring = 0.018 + 0.006 * (idx % 4);
  const along = (idx - 1.5) * 0.009;
  // offset due-east (sea side) of the port
  const lat = pLat + along * 0.0001;
  const lon = pLon + ring / Math.cos((pLat * Math.PI) / 180);
  return { lat, lon };
}

/** Deterministic berth-side position so servicing ships don't jitter */
function berthPos(pLat: number, pLon: number, idx: number) {
  const offset = 0.003 + idx * 0.0015;
  return {
    lat: pLat + (idx % 2 === 0 ? offset : -offset * 0.3),
    lon: pLon + offset * 0.5,
  };
}

// ── Hook ────────────────────────────────────────────────────────────────────
export function useSimulation({
  portLat,
  portLon,
  vessels,
}: {
  portLat: number;
  portLon: number;
  vessels: SimVessel[];
}) {
  // ── Find earliest departure so simulation starts just before ships move ──
  function getInitialTime(vs: SimVessel[]): Date {
    if (vs.length === 0) return new Date();
    const earliest = Math.min(...vs.map((v) => new Date(v.departure).getTime()));
    return new Date(earliest - 10 * 60 * 1000);
  }

  const [simTime, setSimTime] = useState<Date>(() => getInitialTime(vessels));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [positions, setPositions] = useState<ShipPosition[]>([]);
  const [halts, setHalts] = useState<Record<string, { hours: number; reason: string }>>({});

  // ── Refs for the animation loop (avoids stale closures) ──────────────────
  const rafRef     = useRef<number | null>(null);
  const lastRef    = useRef<number>(performance.now());
  const simRef     = useRef<Date>(simTime);
  const speedRef   = useRef<number>(speed);
  const haltsRef   = useRef(halts);
  const vesselsRef = useRef(vessels);

  // Keep refs in sync with state
  useEffect(() => { speedRef.current   = speed;   }, [speed]);
  useEffect(() => { haltsRef.current   = halts;   }, [halts]);
  useEffect(() => { vesselsRef.current = vessels; }, [vessels]);

  // ── Reset sim time when vessels change (new ship registered) ─────────────
  useEffect(() => {
    if (vessels.length === 0) return;
    const earliest = Math.min(...vessels.map((v) => new Date(v.departure).getTime()));
    const t = new Date(earliest - 10 * 60 * 1000);
    simRef.current = t;
    setSimTime(t);
  }, [vessels.length]); // only when count changes, not every re-render

  // ── Position interpolator ─────────────────────────────────────────────────
  function interpolate(t: Date, vs: SimVessel[], h: typeof halts): ShipPosition[] {
    const tMs = t.getTime();
    let anchorageIdx = 0;

    return vs.map((v, idx) => {
      const color     = shipColor(idx);
      const depMs     = new Date(v.departure).getTime();
      const distKm    = haversineKm(v.lat, v.lon, portLat, portLon);
      const speedKmh  = Math.max(v.speedKnots, 0.1) * 1.852;
      const travelMs  = (distKm / speedKmh) * 3_600_000;
      const haltExtra = (h[v.id]?.hours ?? 0) * 3_600_000;
      const etaMs     = depMs + travelMs + haltExtra;
      const endMs     = etaMs + v.unloadingHours * 3_600_000;

      let lat: number, lon: number;
      let status: ShipPosition['status'];
      let progress: number;

      if (tMs <= depMs) {
        // ── Not yet departed ── ship sits at its registered position
        lat = v.lat; lon = v.lon;
        status   = 'Approaching';
        progress = 0;

      } else if (tMs < etaMs) {
        // ── On approach ── smooth linear interpolation toward port ──
        const ratio = Math.min(1, (tMs - depMs) / Math.max(travelMs, 1));
        progress = ratio;
        lat = v.lat + (portLat - v.lat) * ratio;
        lon = v.lon + (portLon - v.lon) * ratio;
        status = h[v.id] ? 'Waiting at Anchorage' : 'Approaching';

      } else if (tMs < endMs) {
        // ── Arrived ── show at anchorage briefly, then at berth ──
        const dwellMs = tMs - etaMs;
        if (dwellMs < 2 * 60 * 1000) { // first 2 sim-minutes → anchorage
          const ap = anchoragePos(portLat, portLon, anchorageIdx++);
          lat = ap.lat; lon = ap.lon;
          status = 'Waiting at Anchorage';
        } else {
          const bp = berthPos(portLat, portLon, idx);
          lat = bp.lat; lon = bp.lon;
          status = 'Servicing';
        }
        progress = 1;

      } else {
        // ── Departed ── ship sails away from port at its registered speed ──
        // It moves in the opposite direction (back toward its origin lat/lon)
        const departedMs   = tMs - endMs;
        const departedHours = departedMs / 3_600_000;
        const departDist   = (Math.max(v.speedKnots, 0.1) * 1.852 * departedHours);
        // Fraction of original distance covered in departure direction
        const departRatio  = Math.min(departDist / Math.max(distKm, 1), 1);
        lat = portLat + (v.lat - portLat) * departRatio * 0.45;
        lon = portLon + (v.lon - portLon) * departRatio * 0.45;
        status   = 'Departed';
        progress = 1;
      }

      return {
        ship_id: v.id, lat, lon, status, progress, color, index: idx,
        speed_knots: v.speedKnots,
        eta: new Date(etaMs).toISOString(),
        cargo_type: v.cargoType,
        weight_tonnes: v.loadTonnes,
        operator: v.operator,
        loa_m: v.loa, draft_m: v.draft,
        halted: !!h[v.id],
        halt_hours:  h[v.id]?.hours  ?? 0,
        halt_reason: h[v.id]?.reason ?? '',
      };
    });
  }

  // ── Stable rAF tick — never recreated ─────────────────────────────────────
  const tick = useCallback(() => {
    const now       = performance.now();
    const realDelta = now - lastRef.current;
    lastRef.current = now;

    // Advance sim clock by (realDelta × SIM_SCALE × speed)
    const simDelta = realDelta * SIM_SCALE * speedRef.current;
    const nextSim  = new Date(simRef.current.getTime() + simDelta);
    simRef.current = nextSim;

    // Batch both state updates together
    const newPos = interpolate(nextSim, vesselsRef.current, haltsRef.current);
    setSimTime(new Date(nextSim));
    setPositions(newPos);

    rafRef.current = requestAnimationFrame(tick);
  // tick is intentionally stable — it reads everything via refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portLat, portLon]);

  // ── Start / stop rAF ──────────────────────────────────────────────────────
  useEffect(() => {
    if (playing) {
      lastRef.current = performance.now();
      rafRef.current  = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, tick]);

  // ── Re-render when paused (halt / vessel change) ──────────────────────────
  useEffect(() => {
    if (!playing) {
      setPositions(interpolate(simRef.current, vessels, halts));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halts, vessels, playing]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const play = useCallback(() => {
    lastRef.current = performance.now();
    setPlaying(true);
  }, []);

  const pause = useCallback(() => setPlaying(false), []);

  const reset = useCallback(() => {
    setPlaying(false);
    // Go back to just before the first departure
    const vs = vesselsRef.current;
    const t =
      vs.length > 0
        ? new Date(Math.min(...vs.map((v) => new Date(v.departure).getTime())) - 10 * 60 * 1000)
        : new Date();
    simRef.current = t;
    setSimTime(t);
    setPositions(interpolate(t, vs, haltsRef.current));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portLat, portLon]);

  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);

  // ── Emergency halt ────────────────────────────────────────────────────────
  const applyHalt = useCallback(async (shipId: string, haltHours: number, reason: string) => {
    setHalts((prev) => ({
      ...prev,
      [shipId]: { hours: (prev[shipId]?.hours ?? 0) + haltHours, reason },
    }));
    try {
      await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ship_id: shipId, halt_hours: haltHours, reason }),
      });
    } catch (e) {
      console.warn('Backend halt sync failed:', e);
    }
  }, []);

  const clearHalt = useCallback(async (shipId: string) => {
    setHalts((prev) => { const n = { ...prev }; delete n[shipId]; return n; });
    try {
      await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, {
        method: 'DELETE',
      });
    } catch (e) {
      console.warn('Backend halt clear failed:', e);
    }
  }, []);

  return { simTime, playing, speed, positions, halts, play, pause, reset, setSpeed, applyHalt, clearHalt };
}
