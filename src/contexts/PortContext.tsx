/**
 * PortContext – all server state is owned by the Python FastAPI backend.
 * This context layer fetches, caches and re-exposes that state to every page.
 *
 * Key design decisions
 * ─────────────────────
 * • The backend is the single source of truth for vessels, optimization,
 *   simulation time and port selection.
 * • Local-only state (selected vessel highlight, alert acknowledgement,
 *   berth/crane overrides, drafts, simulation play/speed) remains in React.
 * • Every write action (addVessel, runOptimization, etc.) calls the API and
 *   then refreshes the relevant slices.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../services/api';
import type {
  ActivePort,
  ApiVessel,
  DashboardKpis,
  MapSnapshot,
  OptimizationResult as ApiOptResult,
  PortSummary,
  Scenario,
  CraneSettings,
  ApiAlert,
} from '../services/api';
import type {
  Berth,
  Crane,
  CraneAllocation,
  OptimizationResult,
  PortAlert,
  PortSettings,
  Vessel,
  VesselDerived,
} from '../types';
import { berths as seedBerths, cranes as seedCranes, defaultSettings } from '../data/port';
import { deriveVessel } from '../utils/geo';
import { allocateCranes } from '../utils/optimization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a backend ApiVessel into the frontend Vessel type. */
function apiToVessel(v: ApiVessel): Vessel {
  return {
    id: v.ship_id,
    operator: v.operator,
    cargoType: v.cargo_type as Vessel['cargoType'],
    loadTonnes: v.weight_tonnes,
    teu: v.load_teu,
    loa: v.loa_m,
    draft: v.draft_m,
    unloadingHours: v.unload_hours,
    speedKnots: v.speed_knots,
    lat: v.latitude,
    lon: v.longitude,
    departure: v.start_dt,
    spoilable: v.spoilable,
    spoilageWindowHours: v.spoilage_deadline
      ? Math.max(
          0,
          (new Date(v.spoilage_deadline).getTime() - new Date(v.eta).getTime()) / 3_600_000,
        )
      : 0,
    status: 'approaching',
  };
}

/** Convert backend ApiAlert into frontend PortAlert. */
/** Map backend API result to the local OptimizationResult shape. */
function apiOptToLocal(r: ApiOptResult): OptimizationResult {
  return {
    // The backend does not return assignments/anchorage/trace directly, so
    // we provide safe defaults so existing components don't break.
    assignments: [],
    unassigned: [],
    anchorage: [],
    totalWaitingHours: 0,
    score: 0,
    objectiveValue: 0,
    iterations: 0,
    quboVariables: r.qubo_variables ?? 0,
    constraints: r.constraints ?? 0,
    berthUtilization: 0,
    solvedAt: new Date().toISOString(),
    trace: [],
    // Attach backend-specific extras
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    berth_schedule: r.berth_schedule as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crane_schedule: r.crane_schedule as any[],
    optimized: r.optimized,
  };
}

function apiToAlert(a: ApiAlert, now: string): PortAlert {
  return {
    id: a.id,
    severity: a.severity,
    title: a.title,
    message: a.message,
    at: now,
    acknowledged: false,
  };
}

// ---------------------------------------------------------------------------
// Context value shape
// ---------------------------------------------------------------------------

interface PortContextValue {
  /* ── port metadata ── */
  portList: PortSummary[];
  activePort: ActivePort | null;
  settings: PortSettings;
  updateSettings: (patch: Partial<PortSettings>) => void;
  selectPort: (name: string) => Promise<void>;
  port: { lat: number; lon: number; name: string };

  /* ── vessels ── */
  vessels: Vessel[];
  derived: Record<string, VesselDerived>;
  addVessel: (vessel: Vessel) => Promise<void>;
  removeVessel: (id: string) => Promise<void>;
  clearVessels: () => Promise<void>;
  /** These are no-ops kept for backwards-compat with non-migrated components */
  updateVessel: (id: string, patch: Partial<Vessel>) => void;

  /* ── berths / cranes (local override layer) ── */
  berths: Berth[];
  updateBerth: (id: string, patch: Partial<Berth>) => void;
  cranes: Crane[];
  updateCrane: (id: string, patch: Partial<Crane>) => void;
  craneAllocations: CraneAllocation[];

  /* ── scenario & crane settings ── */
  scenario: Scenario;
  updateScenario: (s: Scenario) => Promise<void>;
  craneSettings: CraneSettings;
  updateCraneSettings: (s: CraneSettings) => Promise<void>;

  /* ── optimization ── */
  optimization: OptimizationResult | null;
  solving: boolean;
  runOptimization: () => Promise<void>;

  /* ── map snapshot ── */
  mapSnapshot: MapSnapshot | null;
  refreshMap: () => Promise<void>;

  /* ── dashboard kpis ── */
  kpis: DashboardKpis | null;
  refreshKpis: () => Promise<void>;

  /* ── alerts ── */
  alerts: PortAlert[];
  acknowledgeAlert: (id: string) => void;
  acknowledgeAll: () => void;

  /* ── simulation clock ── */
  now: Date;
  playing: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  reset: () => void;
  setSpeed: (s: number) => void;
  advanceSim: (minutes?: number) => Promise<void>;

  /* ── ui state ── */
  selectedVesselId: string | null;
  selectVessel: (id: string | null) => void;
  drafts: Partial<Vessel>[];
  saveDraft: (draft: Partial<Vessel>) => void;
  removeDraft: (index: number) => void;

  /* ── loading flag ── */
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PortContext = createContext<PortContextValue | null>(null);

export function PortProvider({ children }: { children: React.ReactNode }) {
  // ── local-only UI state ──────────────────────────────────────────────────
  const [settings, setSettings] = useState<PortSettings>(defaultSettings);
  const [berths, setBerths] = useState<Berth[]>(seedBerths);
  const [cranes, setCranes] = useState<Crane[]>(seedCranes);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Vessel>[]>([]);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeedState] = useState(1);

  // ── server state ─────────────────────────────────────────────────────────
  const [portList, setPortList] = useState<PortSummary[]>([]);
  const [activePort, setActivePort] = useState<ActivePort | null>(null);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);
  const [solving, setSolving] = useState(false);
  const [mapSnapshot, setMapSnapshot] = useState<MapSnapshot | null>(null);
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [rawAlerts, setRawAlerts] = useState<ApiAlert[]>([]);
  const [scenario, setScenario] = useState<Scenario>({
    ships: 12, unload_hours: 8, load_teu: 18920, priority: 3, disaster: false,
  });
  const [craneSettings, setCraneSettings] = useState<CraneSettings>({
    cranes: 8, rate_tph: 1200,
  });
  const [simTime, setSimTime] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);

  const timer = useRef<number | null>(null);

  // ── simulation clock ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setSimTime((prev) => new Date(prev.getTime() + speed * 1000));
    }, 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, speed]);

  // ── boot: load everything from the backend ────────────────────────────────
  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [ports, port, vs, sc, cs, opt, snap, kpisData, alertsData] = await Promise.all([
        api.listPorts(),
        api.getActivePort(),
        api.getVessels(),
        api.getScenario(),
        api.getCraneSettings(),
        api.getOptimizationResult().catch(() => null),
        api.getMapSnapshot().catch(() => null),
        api.getDashboardKpis().catch(() => null),
        api.getAlerts().catch(() => []),
      ]);
      setPortList(ports);
      setActivePort(port);
      setSettings((prev) => ({
        ...prev,
        portName: port.short,
        portLat: port.lat,
        portLon: port.lon,
      }));
      setVessels(vs.map(apiToVessel));
      setScenario(sc);
      setCraneSettings(cs);
      if (opt) setOptimization(apiOptToLocal(opt));
      if (snap) {
        setMapSnapshot(snap);
        setSimTime(new Date(snap.simulation_time));
      }
      if (kpisData) setKpis(kpisData);
      setRawAlerts(alertsData);
      if (vs.length > 0) setSelectedVesselId(vs[0].ship_id);
    } catch (err) {
      console.error('NexusPort bootstrap error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  // ── derived vessel data ───────────────────────────────────────────────────
  const port = useMemo(
    () => ({ lat: settings.portLat, lon: settings.portLon, name: settings.portName }),
    [settings.portLat, settings.portLon, settings.portName],
  );

  const derived = useMemo(() => {
    const map: Record<string, VesselDerived> = {};
    vessels.forEach((v) => { map[v.id] = deriveVessel(v, port); });
    return map;
  }, [vessels, port]);

  // ── crane allocations (local) ─────────────────────────────────────────────
  const craneAllocations = useMemo<CraneAllocation[]>(() => {
    const assignments = optimization?.assignments ?? [];
    return allocateCranes(cranes, assignments, vessels, simTime);
  }, [cranes, optimization, vessels, simTime]);

  // ── alerts (merge server alerts with local acknowledgement) ───────────────
  const alerts = useMemo<PortAlert[]>(() => {
    const now = simTime.toISOString();
    return rawAlerts
      .map((a) => ({ ...apiToAlert(a, now), acknowledged: acknowledged.includes(a.id) }))
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2, system: 3 };
        return order[a.severity] - order[b.severity];
      });
  }, [rawAlerts, acknowledged, simTime]);

  // ── port selection ────────────────────────────────────────────────────────
  const selectPort = useCallback(async (name: string) => {
    await api.selectPort(name);
    const [port, snap, kpisData, alertsData, opt] = await Promise.all([
      api.getActivePort(),
      api.getMapSnapshot().catch(() => null),
      api.getDashboardKpis().catch(() => null),
      api.getAlerts().catch(() => []),
      api.getOptimizationResult().catch(() => null),
    ]);
    setActivePort(port);
    setSettings((prev) => ({ ...prev, portName: port.short, portLat: port.lat, portLon: port.lon }));
    if (snap) { setMapSnapshot(snap); setSimTime(new Date(snap.simulation_time)); }
    if (kpisData) setKpis(kpisData);
    setRawAlerts(alertsData);
    if (opt) setOptimization(apiOptToLocal(opt));
  }, []);

  // ── vessel mutations ──────────────────────────────────────────────────────
  const addVessel = useCallback(async (vessel: Vessel) => {
    const added = await api.addVessel({
      ship_id: vessel.id,
      operator: vessel.operator,
      cargo_type: vessel.cargoType,
      weight_tonnes: vessel.loadTonnes,
      load_teu: vessel.teu,
      loa_m: vessel.loa,
      draft_m: vessel.draft,
      unload_hours: vessel.unloadingHours,
      latitude: vessel.lat,
      longitude: vessel.lon,
      speed_knots: vessel.speedKnots,
      spoilable: vessel.spoilable,
      spoilage_window_hours: vessel.spoilageWindowHours,
    });
    setVessels((prev) => [...prev, apiToVessel(added)]);
    setSelectedVesselId(added.ship_id);
    // refresh alerts & kpis
    const [alertsData, kpisData, opt] = await Promise.all([
      api.getAlerts().catch(() => []),
      api.getDashboardKpis().catch(() => null),
      api.getOptimizationResult().catch(() => null),
    ]);
    setRawAlerts(alertsData);
    if (kpisData) setKpis(kpisData);
    if (opt) setOptimization(apiOptToLocal(opt));
  }, []);

  const removeVessel = useCallback(async (id: string) => {
    await api.removeVessel(id);
    setVessels((prev) => prev.filter((v) => v.id !== id));
    setSelectedVesselId((cur) => (cur === id ? null : cur));
    const [alertsData, kpisData] = await Promise.all([
      api.getAlerts().catch(() => []),
      api.getDashboardKpis().catch(() => null),
    ]);
    setRawAlerts(alertsData);
    if (kpisData) setKpis(kpisData);
  }, []);

  const clearVessels = useCallback(async () => {
    await api.clearVessels();
    setVessels([]);
    setSelectedVesselId(null);
    setOptimization(null);
    const [alertsData, kpisData] = await Promise.all([
      api.getAlerts().catch(() => []),
      api.getDashboardKpis().catch(() => null),
    ]);
    setRawAlerts(alertsData);
    if (kpisData) setKpis(kpisData);
  }, []);

  // no-op kept for backwards compat
  const updateVessel = useCallback((_id: string, _patch: Partial<Vessel>) => {}, []);

  // ── scenario & crane settings ─────────────────────────────────────────────
  const updateScenario = useCallback(async (s: Scenario) => {
    const saved = await api.setScenario(s);
    setScenario(saved);
    const kpisData = await api.getDashboardKpis().catch(() => null);
    if (kpisData) setKpis(kpisData);
  }, []);

  const updateCraneSettings = useCallback(async (s: CraneSettings) => {
    const saved = await api.setCraneSettings(s);
    setCraneSettings(saved);
  }, []);

  // ── optimization ──────────────────────────────────────────────────────────
  const runOptimization = useCallback(async () => {
    setSolving(true);
    try {
      const result = await api.runOptimization();
      setOptimization(apiOptToLocal(result));
      const [snap, kpisData, alertsData] = await Promise.all([
        api.getMapSnapshot().catch(() => null),
        api.getDashboardKpis().catch(() => null),
        api.getAlerts().catch(() => []),
      ]);
      if (snap) setMapSnapshot(snap);
      if (kpisData) setKpis(kpisData);
      setRawAlerts(alertsData);
    } finally {
      setSolving(false);
    }
  }, []);

  // ── map refresh ───────────────────────────────────────────────────────────
  const refreshMap = useCallback(async () => {
    const snap = await api.getMapSnapshot().catch(() => null);
    if (snap) setMapSnapshot(snap);
  }, []);

  // ── kpis refresh ──────────────────────────────────────────────────────────
  const refreshKpis = useCallback(async () => {
    const data = await api.getDashboardKpis().catch(() => null);
    if (data) setKpis(data);
  }, []);

  // ── simulation ────────────────────────────────────────────────────────────
  const advanceSim = useCallback(async (minutes = 15) => {
    // For negative steps, manually compute from current sim time
    if (minutes < 0) {
      const newTime = new Date(simTime.getTime() + minutes * 60_000);
      const res = await api.setSimTime(newTime.toISOString());
      setSimTime(new Date(res.simulation_time));
    } else {
      const res = await api.advanceSim(minutes);
      setSimTime(new Date(res.simulation_time));
    }
    await refreshMap();
  }, [refreshMap, simTime]);

  const reset = useCallback(async () => {
    const res = await api.resetSim();
    setSimTime(new Date(res.simulation_time));
    setPlaying(false);
    setSpeedState(settings.simulationSpeed);
    await refreshMap();
  }, [settings.simulationSpeed, refreshMap]);

  // ── local state helpers ───────────────────────────────────────────────────
  const updateSettings = useCallback((patch: Partial<PortSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateBerth = useCallback((id: string, patch: Partial<Berth>) => {
    setBerths((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const updateCrane = useCallback((id: string, patch: Partial<Crane>) => {
    setCranes((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
    setPlaying(true);
  }, []);

  // ── value ─────────────────────────────────────────────────────────────────
  const value: PortContextValue = {
    portList,
    activePort,
    settings,
    updateSettings,
    selectPort,
    port,

    vessels,
    derived,
    addVessel,
    updateVessel,
    removeVessel,
    clearVessels,

    berths,
    updateBerth,
    cranes,
    updateCrane,
    craneAllocations,

    scenario,
    updateScenario,
    craneSettings,
    updateCraneSettings,

    optimization,
    solving,
    runOptimization,

    mapSnapshot,
    refreshMap,

    kpis,
    refreshKpis,

    alerts,
    acknowledgeAlert: (id) =>
      setAcknowledged((prev) => (prev.includes(id) ? prev : [...prev, id])),
    acknowledgeAll: () => setAcknowledged(alerts.map((a) => a.id)),

    now: simTime,
    playing,
    speed,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    reset,
    setSpeed,
    advanceSim,

    selectedVesselId,
    selectVessel: setSelectedVesselId,

    drafts,
    saveDraft: (draft) => setDrafts((prev) => [...prev, draft]),
    removeDraft: (index) => setDrafts((prev) => prev.filter((_, i) => i !== index)),

    loading,
  };

  return <PortContext.Provider value={value}>{children}</PortContext.Provider>;
}

export function usePort(): PortContextValue {
  const ctx = useContext(PortContext);
  if (!ctx) throw new Error('usePort must be used inside PortProvider');
  return ctx;
}
