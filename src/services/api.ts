/**
 * NexusPort API service layer
 * All fetch calls to the Python FastAPI backend go through this module.
 */

// In production (Vercel), set VITE_API_URL to your Railway backend URL.
// Locally it defaults to localhost:8000.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BASE_URL: string = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Types mirrored from backend ─────────────────────────────────────────────

export interface PortSummary {
  key: string;
  short: string;
  state: string;
  berths: number;
  lat: number;
  lon: number;
  notes: string;
  source: string;
}

export interface ActivePort {
  name: string;
  short: string;
  lat: number;
  lon: number;
  state: string;
  berths: number;
  berth_label: string;
  notes: string;
  source: string;
  url: string;
  names: string[];
  berth_profiles: Record<string, BerthProfile>;
}

export interface BerthProfile {
  name: string;
  capacity_tonnes: number;
  max_loa_m: number;
  max_draft_m: number;
  cargo_types: string[];
  handling_rate_tph: number;
}

export interface ApiBerth {
  name: string;
  lat: number;
  lon: number;
  capacity_tonnes: number;
  max_loa_m: number;
  max_draft_m: number;
  cargo_types: string[];
  handling_rate_tph: number;
}

export interface ApiVessel {
  ship_id: string;
  operator: string;
  cargo_type: string;
  weight_tonnes: number;
  load_teu: number;
  loa_m: number;
  draft_m: number;
  unload_hours: number;
  latitude: number;
  longitude: number;
  speed_knots: number;
  distance_km: number;
  travel_hours: number;
  start_dt: string;
  eta: string;
  expected_end: string;
  spoilable: boolean;
  spoilage_deadline: string | null;
  updated_at: string;
}

export interface VesselIn {
  ship_id: string;
  operator?: string;
  cargo_type?: string;
  weight_tonnes?: number;
  load_teu?: number;
  loa_m?: number;
  draft_m?: number;
  unload_hours?: number;
  latitude?: number;
  longitude?: number;
  speed_knots?: number;
  spoilable?: boolean;
  spoilage_window_hours?: number;
}

export interface Scenario {
  ships: number;
  unload_hours: number;
  load_teu: number;
  priority: number;
  disaster: boolean;
}

export interface CraneSettings {
  cranes: number;
  rate_tph: number;
}

export interface BerthRow {
  ship_id: string;
  berth: string;
  berth_capacity_t: number | string;
  operator: string;
  cargo: string;
  weight_tonnes: number;
  loa_m: number | string;
  draft_m: number | string;
  requested_start: string;
  actual_start: string;
  unload_end: string;
  berth_wait_hours: number;
  status: string;
}

export interface CraneRow {
  ship_id: string;
  berth: string;
  crane: string;
  weight_tonnes: number;
  spoilable: boolean;
  ready_after_unloading: string;
  transport_start: string;
  transport_end: string;
  priority_reason: string;
  deadline_status: string;
}

export interface OptimizationResult {
  berth_schedule: BerthRow[];
  crane_schedule: CraneRow[];
  qubo_variables: number;
  constraints: number;
  optimized: boolean;
}

export interface MapShip {
  ship_id: string;
  lat: number;
  lon: number;
  color: string;
  status: string;
  wait_hours: number;
  assigned_berth: string;
  eta: string;
  cargo_type: string;
  weight_tonnes: number;
  loa_m: number;
  draft_m: number;
  operator: string;
  index: number;
}

export interface MapBerth {
  name: string;
  lat: number;
  lon: number;
  occupied: boolean;
  assigned_ships: string[];
  capacity_tonnes: number;
  max_loa_m: number;
  max_draft_m: number;
  cargo_types: string[];
}

export interface MapSnapshot {
  port: { name: string; short: string; lat: number; lon: number };
  simulation_time: string;
  berths: MapBerth[];
  ships: MapShip[];
  counters: { approaching: number; waiting: number; servicing: number };
}

export interface DashboardKpis {
  total_ships: number;
  total_load_teu: number;
  total_berths: number;
  crane_count: number;
  avg_dwell_days: number;
  throughput: number;
  berth_utilization: number;
  crane_utilization: number;
  active_cranes: number;
  total_wait_hours: number;
  waiting_vessels: number;
  optimized: boolean;
  optimized_wait_hours: number;
  baseline_wait_hours: number;
  scenario_priority_score: number;
  disaster_mode: boolean;
  berth_utilization_chart: { berth: string; utilization: number; load: number; capacity: number }[];
  throughput_trend: {
    classical: { hour: number; teu: number }[];
    optimized: { hour: number; teu: number }[];
  };
  crane_pie: { working: number; maintenance: number };
  optimization_comparison: {
    classical: Record<string, string>;
    optimized: Record<string, string>;
  };
}

export interface ApiAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info' | 'system';
  title: string;
  message: string;
}

export interface Analytics {
  arrival_history: {
    day: string;
    arrivals: number;
    departures: number;
    teu: number;
    tonnes: number;
    waiting: number;
    eta_accuracy: number;
  }[];
  utilization_history: { hour: string; berth: number; crane: number }[];
}

export interface ReportData {
  port: string;
  ships: number;
  cargo_teu: number;
  unload_time_h: number;
  berths: number;
  emergency: boolean;
  optimized: boolean;
  registered_vessels: number;
}

export interface YardHeatmap {
  z: number[][];
  x: string[];
  y: string[];
}

// ── API functions ────────────────────────────────────────────────────────────

/** Ports */
export const api = {
  // Ports
  listPorts: () => request<PortSummary[]>('/ports'),
  selectPort: (port_name: string) =>
    request<{ selected: string }>('/ports/select', {
      method: 'POST',
      body: JSON.stringify({ port_name }),
    }),
  getActivePort: () => request<ActivePort>('/ports/active'),

  // Berths
  getBerths: () => request<ApiBerth[]>('/berths'),

  // Vessels
  getVessels: () => request<ApiVessel[]>('/vessels'),
  addVessel: (vessel: VesselIn) =>
    request<ApiVessel>('/vessels', { method: 'POST', body: JSON.stringify(vessel) }),
  removeVessel: (ship_id: string) =>
    request<{ deleted: string }>(`/vessels/${encodeURIComponent(ship_id)}`, { method: 'DELETE' }),
  clearVessels: () => request<{ cleared: boolean }>('/vessels', { method: 'DELETE' }),

  // Scenario
  getScenario: () => request<Scenario>('/scenario'),
  setScenario: (scenario: Scenario) =>
    request<Scenario>('/scenario', { method: 'PUT', body: JSON.stringify(scenario) }),

  // Crane settings
  getCraneSettings: () => request<CraneSettings>('/crane-settings'),
  setCraneSettings: (settings: CraneSettings) =>
    request<CraneSettings>('/crane-settings', { method: 'PUT', body: JSON.stringify(settings) }),

  // Optimization
  runOptimization: () => request<OptimizationResult>('/optimize', { method: 'POST' }),
  getOptimizationResult: () => request<OptimizationResult>('/optimization/result'),

  // Simulation
  getSimTime: () => request<{ simulation_time: string }>('/simulation/time'),
  setSimTime: (simulation_time: string) =>
    request<{ simulation_time: string }>('/simulation/time', {
      method: 'PUT',
      body: JSON.stringify({ simulation_time }),
    }),
  advanceSim: (minutes = 15) =>
    request<{ simulation_time: string }>(`/simulation/advance?minutes=${minutes}`, {
      method: 'POST',
    }),
  resetSim: () =>
    request<{ simulation_time: string }>('/simulation/reset', { method: 'POST' }),

  // Map
  getMapSnapshot: () => request<MapSnapshot>('/map/snapshot'),

  // Dashboard
  getDashboardKpis: () => request<DashboardKpis>('/dashboard/kpis'),

  // Alerts
  getAlerts: () => request<ApiAlert[]>('/alerts'),

  // Analytics
  getAnalytics: () => request<Analytics>('/analytics'),

  // Reports
  getReports: () => request<ReportData>('/reports'),

  // Yard
  getYardHeatmap: () => request<YardHeatmap>('/yard/heatmap'),

  // Health
  health: () => request<{ status: string; vessels: number; port: string }>('/health'),
};

// ── New interactive feature endpoints ──────────────────────────────────────

export interface PositionValidation {
  valid: boolean;
  reason: string;
  distance_km: number;
  too_close: boolean;
  lat: number;
  lon: number;
}

export interface BerthCapacityCheck {
  compatible_berths: BerthCompatResult[];
  incompatible_berths: BerthCompatResult[];
  any_compatible: boolean;
  best_berth: string | null;
}

export interface BerthCompatResult {
  berth: string;
  compatible: boolean;
  reasons: string[];
  berth_capacity_t: number;
  load_pct: number;
  max_loa_m: number;
  max_draft_m: number;
  cargo_types: string[];
}

export interface EmergencyHaltResult {
  ship_id: string;
  new_eta: string;
  new_expected_end: string;
  total_halt_hours: number;
  reason: string;
}

export interface ShipPositionEntry {
  ship_id: string;
  lat: number;
  lon: number;
  status: string;
  halted: boolean;
  halt_hours: number;
  halt_reason: string;
  speed_knots: number;
  eta: string | null;
  color: string;
  index: number;
  cargo_type: string;
  weight_tonnes: number;
  operator: string;
  loa_m: number;
  draft_m: number;
}

export interface CraneOptimizeResult {
  assignments: CraneRow[];
  utilization: {
    crane: string;
    assigned_load_t: number;
    utilization_pct: number;
    deviation_from_ideal_t: number;
  }[];
  total_load_t: number;
  ideal_per_crane_t: number;
  balance_score: number;
  balanced: boolean;
  crane_count: number;
  rate_tph: number;
}

// Extend api object with new endpoints
Object.assign(api, {
  validatePosition: (lat: number, lon: number) =>
    request<PositionValidation>(`/validate/position?lat=${lat}&lon=${lon}`),

  berthCapacityCheck: (weight_tonnes: number, loa_m: number, draft_m: number, cargo_type = 'general cargo') =>
    request<BerthCapacityCheck>(
      `/berths/capacity-check?weight_tonnes=${weight_tonnes}&loa_m=${loa_m}&draft_m=${draft_m}&cargo_type=${encodeURIComponent(cargo_type)}`
    ),

  applyEmergencyHalt: (ship_id: string, halt_hours: number, reason: string) =>
    request<EmergencyHaltResult>(`/vessels/${encodeURIComponent(ship_id)}/emergency-halt`, {
      method: 'POST',
      body: JSON.stringify({ ship_id, halt_hours, reason }),
    }),

  clearEmergencyHalt: (ship_id: string) =>
    request<{ ship_id: string; cleared: boolean }>(
      `/vessels/${encodeURIComponent(ship_id)}/emergency-halt`,
      { method: 'DELETE' }
    ),

  getShipPositions: () =>
    request<{ simulation_time: string; ships: ShipPositionEntry[]; scale_factor: number }>(
      '/simulation/ship-positions'
    ),

  optimizeCranes: () =>
    request<CraneOptimizeResult>('/cranes/optimize', { method: 'POST' }),
});
