/**
 * useOptimization – Dynamic Hybrid Optimization Hook
 * ────────────────────────────────────────────────────
 * Bridges the rolling-horizon Python engine with the React simulation.
 *
 * Responsibilities:
 *   • Holds optimizer configuration (algo, crane rate, efficiency, etc.)
 *   • Triggers /optimization/run when vessels change or events fire
 *   • Maintains live ship cargo state (remaining, processed, predicted departure)
 *   • Polls /optimization/live-state at low frequency (every 5s)
 *     while animation runs at 60fps via useSimulation
 *   • Exposes comparison table, event log, and "why" explanations
 *   • Triggers re-optimization on arrival / berth-free / halt events
 *
 * IMPORTANT: Does NOT run on every rAF frame — only on scheduling events.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type OptAlgo = 'FCFS' | 'SJF' | 'SRPT' | 'Greedy' | 'QAOA' | 'Hybrid' | 'Auto';

export interface OptConfig {
  algo:           OptAlgo;
  crane_rate_tpm: number;  // tonnes per minute per crane
  efficiency:     number;  // 0–1
  switch_cost:    number;  // minutes
  aging_rate:     number;
  preemption:     boolean;
  rolling:        boolean;
  qaoa_enabled:   boolean;
  crane_count:    number;
}

export const DEFAULT_OPT_CONFIG: OptConfig = {
  algo:           'Hybrid',
  crane_rate_tpm: 10,
  efficiency:     0.90,
  switch_cost:    5,
  aging_rate:     0.05,
  preemption:     true,
  rolling:        true,
  qaoa_enabled:   true,
  crane_count:    4,
};

export interface ScheduleEntry {
  ship_id:              string;
  berth_id:             string | null;
  crane_id:             string | null;
  algo:                 string;
  compatible:           boolean;
  wait_min:             number;
  processing_time_min:  number;
  service_start_ms:     number;
  service_end_ms:       number;
  departure_delay_min:  number;
  crane_idle_min:       number;
  switch_cost_min:      number;
  berth_idle_min:       number;
  fairness_penalty:     number;
  reason:               string;
  remaining_cargo_t:    number;
  predicted_departure:  string | null;
}

export interface LiveShipState {
  ship_id:              string;
  operator:             string;
  cargo_type:           string;
  original_cargo_t:     number;
  remaining_cargo_t:    number;
  processed_cargo_t:    number;
  loa_m:                number;
  draft_m:              number;
  berth:                string | null;
  cranes:               string[];
  status:               string;
  arrival_time:         string | null;
  eta:                  string | null;
  start_processing:     string | null;
  predicted_completion: string | null;
  predicted_departure:  string | null;
  waiting_time_min:     number;
  num_preemptions:      number;
  processing_rate_tpm:  number;
  halted:               boolean;
  halt_hours:           number;
  weight_tonnes:        number;
}

export interface OptEvent {
  timestamp:   string;
  event_type:  string;
  description: string;
  ship_id:     string | null;
  berth_id:    string | null;
  crane_id:    string | null;
  old_value:   string | null;
  new_value:   string | null;
}

export interface AlgoMetrics {
  objective:       number;
  avg_wait_min:    number;
  max_wait_min:    number;
  avg_flow_min:    number;
  crane_idle_min:  number;
  berth_util_pct:  number;
  throughput:      number;
  runtime_ms:      number;
  mode?:           string;
}

export interface ComparisonResult {
  FCFS:    AlgoMetrics;
  SJF:     AlgoMetrics;
  SRPT:    AlgoMetrics;
  Greedy:  AlgoMetrics;
  QAOA:    AlgoMetrics;
  Hybrid?: AlgoMetrics;
}

export interface OptMeta {
  algo:              string;
  objective:         number;
  runtime_s:         number;
  ships_scheduled:   number;
  timestamp:         string;
  winner?:           string;
  comparison?:       Record<string, number>;
  qaoa_meta?:        Record<string, any>;
  mode?:             string;
}

export interface ProcessingTimeInfo {
  cargo_tonnes:        number;
  crane_count:         number;
  rate_tpm:            number;
  efficiency:          number;
  effective_rate_tpm:  number;
  processing_time_min: number;
  processing_time_hrs: number;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOptimization() {
  const [config, setConfig]             = useState<OptConfig>(DEFAULT_OPT_CONFIG);
  const [schedule, setSchedule]         = useState<ScheduleEntry[]>([]);
  const [liveShips, setLiveShips]       = useState<LiveShipState[]>([]);
  const [eventLog, setEventLog]         = useState<OptEvent[]>([]);
  const [meta, setMeta]                 = useState<OptMeta | null>(null);
  const [comparison, setComparison]     = useState<ComparisonResult | null>(null);
  const [running, setRunning]           = useState(false);
  const [comparing, setComparing]       = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [selectedEntry, setSelected]    = useState<ScheduleEntry | null>(null);

  const pollTimer  = useRef<number | null>(null);
  const configRef  = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  // ── Push config to backend ────────────────────────────────────────────────
  const pushConfig = useCallback(async (cfg: OptConfig) => {
    try {
      await fetch(`${BASE_URL}/optimization/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
    } catch { /* silent */ }
  }, []);

  const updateConfig = useCallback((patch: Partial<OptConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...patch };
      pushConfig(next);
      return next;
    });
  }, [pushConfig]);

  // ── Run optimization ──────────────────────────────────────────────────────
  const runOptimization = useCallback(async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/optimization/run`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSchedule(data.schedule ?? []);
      setMeta(data.meta ?? null);
      setEventLog(prev => [...prev, ...(data.event_log ?? [])].slice(-200));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  // ── Poll live state ────────────────────────────────────────────────────────
  const pollLiveState = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/optimization/live-state`);
      if (!res.ok) return;
      const data = await res.json();
      setLiveShips(data.ships   ?? []);
      setSchedule(data.schedule ?? []);
      setMeta(data.meta         ?? null);
      setEventLog(data.event_log ?? []);
    } catch { /* silent */ }
  }, []);

  // Poll every 5 seconds while mounted
  useEffect(() => {
    pollLiveState();
    pollTimer.current = window.setInterval(pollLiveState, 5_000);
    return () => { if (pollTimer.current) window.clearInterval(pollTimer.current); };
  }, [pollLiveState]);

  // ── Compare all algorithms ─────────────────────────────────────────────────
  const compareAlgorithms = useCallback(async (): Promise<void> => {
    setComparing(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/optimization/compare-algorithms`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setComparison(data.comparison ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setComparing(false);
    }
  }, []);

  // ── Processing time query ──────────────────────────────────────────────────
  const getProcessingTime = useCallback(async (
    cargo_tonnes: number,
    crane_count?: number,
  ): Promise<ProcessingTimeInfo | null> => {
    try {
      const params = new URLSearchParams({
        cargo_tonnes: String(cargo_tonnes),
        crane_count:  String(crane_count ?? config.crane_count),
        rate_tpm:     String(config.crane_rate_tpm),
        efficiency:   String(config.efficiency),
      });
      const res = await fetch(`${BASE_URL}/optimization/processing-time?${params}`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }, [config]);

  // ── Preemption check ───────────────────────────────────────────────────────
  const checkPreemption = useCallback(async (
    currentShipId: string,
    newShipId: string,
  ): Promise<{ preempt: boolean; reason: string } | null> => {
    try {
      const res = await fetch(`${BASE_URL}/optimization/preemption-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_ship_id: currentShipId, new_ship_id: newShipId }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }, []);

  // ── Event triggers ─────────────────────────────────────────────────────────
  const notifyArrival = useCallback(async (shipId: string) => {
    try {
      await fetch(`${BASE_URL}/optimization/event/arrival`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ship_id: shipId }),
      });
      await pollLiveState();
    } catch { /* silent */ }
  }, [pollLiveState]);

  const notifyBerthFree = useCallback(async (berthId: string) => {
    try {
      await fetch(`${BASE_URL}/optimization/event/berth-free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ berth_id: berthId }),
      });
      await pollLiveState();
    } catch { /* silent */ }
  }, [pollLiveState]);

  const notifyHalt = useCallback(async (shipId: string, haltHours: number) => {
    try {
      await fetch(`${BASE_URL}/optimization/event/halt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ship_id: shipId, halt_hours: haltHours }),
      });
      await pollLiveState();
    } catch { /* silent */ }
  }, [pollLiveState]);

  const notifyHaltCleared = useCallback(async (shipId: string) => {
    try {
      await fetch(`${BASE_URL}/optimization/event/halt-cleared`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ship_id: shipId }),
      });
      await pollLiveState();
    } catch { /* silent */ }
  }, [pollLiveState]);

  // Update remaining cargo for a servicing ship (called by sim on tick)
  const updateShipCargo = useCallback(async (shipId: string, simTimeMs: number) => {
    try {
      const res = await fetch(`${BASE_URL}/optimization/update-cargo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ship_id: shipId, sim_time_ms: simTimeMs }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setLiveShips(prev => prev.map(s =>
        s.ship_id === shipId
          ? { ...s,
              remaining_cargo_t:   data.remaining_cargo_t,
              processed_cargo_t:   (s.original_cargo_t ?? 0) - data.remaining_cargo_t,
              predicted_departure: data.predicted_departure,
            }
          : s,
      ));
    } catch { /* silent */ }
  }, []);

  const resetEngine = useCallback(async () => {
    try {
      await fetch(`${BASE_URL}/optimization/reset`, { method: 'POST' });
      setSchedule([]);
      setLiveShips([]);
      setEventLog([]);
      setMeta(null);
      setComparison(null);
    } catch { /* silent */ }
  }, []);

  // Derived: get live ship state for a given ship_id
  const getLiveShip = useCallback((shipId: string): LiveShipState | undefined => {
    return liveShips.find(s => s.ship_id === shipId);
  }, [liveShips]);

  // Derived: schedule entry (with 'why' reason) for a ship
  const getScheduleEntry = useCallback((shipId: string): ScheduleEntry | undefined => {
    return schedule.find(e => e.ship_id === shipId);
  }, [schedule]);

  return {
    // config
    config, updateConfig,
    // run
    runOptimization, running,
    // data
    schedule, liveShips, eventLog, meta, error,
    // comparison
    comparison, compareAlgorithms, comparing,
    // helpers
    getProcessingTime, checkPreemption,
    getLiveShip, getScheduleEntry,
    // events
    notifyArrival, notifyBerthFree, notifyHalt, notifyHaltCleared,
    updateShipCargo,
    // ui
    selectedEntry, setSelected,
    resetEngine,
    pollLiveState,
  };
}
