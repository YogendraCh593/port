export type CargoType = 'Containers' | 'Bulk' | 'Liquid' | 'Reefer' | 'RoRo' | 'General';

export type VesselStatus = 'approaching' | 'berthed' | 'waiting' | 'departing';

export type CargoPriority = 'standard' | 'high' | 'critical';

export interface Vessel {
  id: string;
  operator: string;
  cargoType: CargoType;
  loadTonnes: number;
  teu: number;
  loa: number;
  draft: number;
  unloadingHours: number;
  speedKnots: number;
  lat: number;
  lon: number;
  /** ISO timestamp the vessel departed origin / began the approach leg */
  departure: string;
  spoilable: boolean;
  /** Hours from departure until cargo spoils. Only meaningful when spoilable. */
  spoilageWindowHours: number;
  status: VesselStatus;
}

export interface VesselDerived {
  distanceKm: number;
  travelHours: number;
  eta: Date;
  expectedEnd: Date;
  spoilageDeadline: Date | null;
  /** Hours of slack between expected berth end and the spoilage deadline. */
  spoilageSlackHours: number | null;
  spoilageRisk: 'none' | 'watch' | 'breach';
  priority: CargoPriority;
}

export interface Berth {
  id: string;
  name: string;
  maxLoa: number;
  maxDraft: number;
  craneSlots: number;
  status: 'operational' | 'maintenance';
}

export interface Crane {
  id: string;
  name: string;
  berthId: string;
  /** tonnes per hour */
  capacityTph: number;
  status: 'operational' | 'maintenance';
}

export interface Assignment {
  vesselId: string;
  berthId: string;
  start: string;
  end: string;
  waitingHours: number;
}

/**
 * OptimizationResult is the unified type used by both the local annealing
 * solver (src/utils/optimization.ts) and the Python backend response.
 * The backend enriches the response with berth_schedule / crane_schedule.
 */
export interface OptimizationResult {
  /* local solver fields */
  assignments: Assignment[];
  unassigned: string[];
  anchorage: AnchorageEntry[];
  totalWaitingHours: number;
  score: number;
  objectiveValue: number;
  iterations: number;
  quboVariables: number;
  constraints: number;
  berthUtilization: number;
  solvedAt: string;
  trace: {iteration: number;objective: number;}[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  berth_schedule?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  crane_schedule?: any[];
  optimized?: boolean;
}

export interface AnchorageEntry {
  vesselId: string;
  zone: string;
  reason: string;
  expectedBerthId: string;
  waitingHours: number;
  priority: CargoPriority;
  spoilageRisk: 'none' | 'watch' | 'breach';
}

export interface CraneAllocation {
  craneId: string;
  berthId: string;
  vesselId: string | null;
  assignedTonnes: number;
  utilization: number;
  status: 'active' | 'available' | 'maintenance';
}

export type AlertSeverity = 'critical' | 'warning' | 'info' | 'system';

export interface PortAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  vesselId?: string;
  at: string;
  acknowledged: boolean;
}

export interface PortSettings {
  portName: string;
  portLat: number;
  portLon: number;
  timezoneLabel: string;
  waitingWeight: number;
  spoilageWeight: number;
  priorityWeight: number;
  annealIterations: number;
  simulationSpeed: number;
  showRouteLines: boolean;
  showVesselLabels: boolean;
}