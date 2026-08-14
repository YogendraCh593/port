/**
 * useSimulation – drives the ship animation loop.
 *
 * Time scaling: 1 real hour = 5 real seconds at speed=1×
 *   → SIM_SCALE = 3600 / 5 = 720 sim-seconds per real-second
 *
 * The hook owns:
 *  • simTime  – the current simulation clock (Date)
 *  • shipPositions – interpolated lat/lon for every vessel (no API call)
 *  • playing / speed controls
 *
 * Ships move smoothly via requestAnimationFrame. Each vessel travels from
 * its registered lat/lon toward the port in a straight geodesic line at its
 * registered speed (converted to deg/sim-second).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL } from '../services/api';

// 1 real hour = 5 real seconds at speed=1  →  720 sim-sec / real-sec
export const SIM_SCALE = 720;

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
  /** 0–1 progress along the approach track */
  progress: number;
}

interface UseSimulationOptions {
  portLat: number;
  portLon: number;
  /** external vessels from PortContext */
  vessels: {
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
  }[];
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371.0088;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const r = Math.round(f(5) * 255).toString(16).padStart(2, '0');
  const g = Math.round(f(3) * 255).toString(16).padStart(2, '0');
  const b = Math.round(f(1) * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function shipColor(idx: number) {
  return hsvToHex((idx * 137.508) % 360, 0.72, 0.95);
}

// Anchorage holding positions just offshore (indexed fan)
function anchoragePos(portLat: number, portLon: number, idx: number) {
  const bearingRad = Math.PI / 2; // due east = sea side
  const ring = 0.018 + 0.006 * (idx % 4);
  const along = (idx - 1.5) * 0.009;
  const lat = portLat + ring * Math.cos(bearingRad) + along * Math.sin(bearingRad);
  const lon =
    portLon +
    (ring * Math.sin(bearingRad) + along * Math.cos(bearingRad)) /
      Math.cos((portLat * Math.PI) / 180);
  return { lat, lon };
}

export function useSimulation({ portLat, portLon, vessels }: UseSimulationOptions) {
  const [simTime, setSimTime] = useState<Date>(() => new Date());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [positions, setPositions] = useState<ShipPosition[]>([]);
  // halt map: ship_id → extra hours added
  const [halts, setHalts] = useState<Record<string, { hours: number; reason: string }>>({});

  const rafRef = useRef<number | null>(null);
  const lastRealRef = useRef<number>(performance.now());
  const simTimeRef = useRef<Date>(simTime);

  // Keep ref in sync
  useEffect(() => { simTimeRef.current = simTime; }, [simTime]);

  // ── Interpolate all ship positions at a given simTime ──────────────────
  const interpolate = useCallback(
    (t: Date): ShipPosition[] => {
      let anchorageIdx = 0;
      return vessels.map((v, idx) => {
        const color = shipColor(idx);
        const departure = new Date(v.departure);
        const distanceKm = haversineKm(v.lat, v.lon, portLat, portLon);
        const speedKmh = Math.max(v.speedKnots, 0.1) * 1.852;
        const travelHours = distanceKm / speedKmh;

        // Apply halt extension
        const haltExtra = halts[v.id]?.hours ?? 0;
        const etaMs = departure.getTime() + (travelHours + haltExtra) * 3_600_000;
        const etaDate = new Date(etaMs);
        const unloadEnd = new Date(etaMs + v.unloadingHours * 3_600_000);

        const tMs = t.getTime();

        let lat: number, lon: number, status: ShipPosition['status'], progress: number;

        if (tMs < departure.getTime()) {
          // Not yet departed — sit at origin
          lat = v.lat;
          lon = v.lon;
          status = 'Approaching';
          progress = 0;
        } else if (tMs < etaDate.getTime()) {
          // On approach — linear interpolation along great-circle track
          const elapsed = tMs - departure.getTime();
          const total = etaDate.getTime() - departure.getTime();
          const ratio = Math.min(1, elapsed / Math.max(total, 1));
          progress = ratio;
          lat = v.lat + (portLat - v.lat) * ratio;
          lon = v.lon + (portLon - v.lon) * ratio;
          status = halts[v.id] ? 'Waiting at Anchorage' : 'Approaching';
        } else if (tMs < unloadEnd.getTime()) {
          // At berth — sit at anchorage holding point while waiting, then berth
          const waited = (tMs - etaDate.getTime()) / 3_600_000;
          if (waited < 0.5) {
            // Just arrived — show at anchorage briefly
            const { lat: aLat, lon: aLon } = anchoragePos(portLat, portLon, anchorageIdx++);
            lat = aLat;
            lon = aLon;
            status = 'Waiting at Anchorage';
          } else {
            lat = portLat + (Math.random() - 0.5) * 0.002;
            lon = portLon + (Math.random() - 0.5) * 0.002;
            status = 'Servicing';
          }
          progress = 1;
        } else {
          // Departed
          lat = portLat + 0.04 + idx * 0.005;
          lon = portLon + 0.04 + idx * 0.003;
          status = 'Departed';
          progress = 1;
        }

        return {
          ship_id: v.id,
          lat, lon, status, progress, color, index: idx,
          speed_knots: v.speedKnots,
          eta: etaDate.toISOString(),
          cargo_type: v.cargoType,
          weight_tonnes: v.loadTonnes,
          operator: v.operator,
          loa_m: v.loa,
          draft_m: v.draft,
          halted: !!halts[v.id],
          halt_hours: halts[v.id]?.hours ?? 0,
          halt_reason: halts[v.id]?.reason ?? '',
        };
      });
    },
    [vessels, portLat, portLon, halts],
  );

  // ── rAF animation loop ─────────────────────────────────────────────────
  const tick = useCallback(() => {
    const now = performance.now();
    const realDeltaMs = now - lastRealRef.current;
    lastRealRef.current = now;

    // Advance sim clock: 1 real-ms → SIM_SCALE * speed sim-ms
    const simDeltaMs = realDeltaMs * SIM_SCALE * speed;
    const nextSim = new Date(simTimeRef.current.getTime() + simDeltaMs);
    simTimeRef.current = nextSim;
    setSimTime(nextSim);
    setPositions(interpolate(nextSim));

    rafRef.current = requestAnimationFrame(tick);
  }, [interpolate, speed]);

  // Start / stop rAF based on playing state
  useEffect(() => {
    if (playing) {
      lastRealRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
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

  // Re-interpolate immediately when not playing (e.g. after halt)
  useEffect(() => {
    if (!playing) setPositions(interpolate(simTimeRef.current));
  }, [halts, vessels, interpolate, playing]);

  const play = useCallback(() => {
    lastRealRef.current = performance.now();
    setPlaying(true);
  }, []);

  const pause = useCallback(() => setPlaying(false), []);

  const reset = useCallback(() => {
    setPlaying(false);
    const t = new Date();
    simTimeRef.current = t;
    setSimTime(t);
    setPositions(interpolate(t));
  }, [interpolate]);

  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
  }, []);

  // ── Emergency halt ─────────────────────────────────────────────────────
  const applyHalt = useCallback(
    async (shipId: string, haltHours: number, reason: string) => {
      // Optimistically update local state immediately
      setHalts((prev) => ({
        ...prev,
        [shipId]: { hours: (prev[shipId]?.hours ?? 0) + haltHours, reason },
      }));
      // Also notify the backend
      try {
        await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ship_id: shipId, halt_hours: haltHours, reason }),
        });
      } catch (e) {
        console.warn('Backend halt sync failed (local state still applied):', e);
      }
    },
    [],
  );

  const clearHalt = useCallback(async (shipId: string) => {
    setHalts((prev) => {
      const next = { ...prev };
      delete next[shipId];
      return next;
    });
    try {
      await fetch(`${BASE_URL}/vessels/${encodeURIComponent(shipId)}/emergency-halt`, {
        method: 'DELETE',
      });
    } catch (e) {
      console.warn('Backend halt clear failed:', e);
    }
  }, []);

  return {
    simTime,
    playing,
    speed,
    positions,
    halts,
    play,
    pause,
    reset,
    setSpeed,
    applyHalt,
    clearHalt,
  };
}
