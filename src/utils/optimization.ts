import type {
  AnchorageEntry,
  Assignment,
  Berth,
  Crane,
  CraneAllocation,
  OptimizationResult,
  PortSettings,
  Vessel,
  VesselDerived } from
'../types';
import { addHours, hoursBetween } from './geo';

export interface SolverInput {
  vessels: Vessel[];
  derived: Record<string, VesselDerived>;
  berths: Berth[];
  settings: PortSettings;
}

/** QUBO sizing: one binary variable per (vessel, berth) pair. */
export function quboVariableCount(vesselCount: number, berthCount: number): number {
  return vesselCount * berthCount;
}

/**
 * Constraint count for the binary quadratic model:
 *  - one-hot assignment per vessel
 *  - non-overlap pair constraint per berth per vessel pair
 *  - physical feasibility (LOA + draft) per vessel/berth pair
 */
export function constraintCount(vesselCount: number, berthCount: number): number {
  const oneHot = vesselCount;
  const overlap = berthCount * (vesselCount * Math.max(0, vesselCount - 1) / 2);
  const feasibility = vesselCount * berthCount * 2;
  return oneHot + overlap + feasibility;
}

function feasible(vessel: Vessel, berth: Berth): boolean {
  return (
    berth.status === 'operational' &&
    vessel.loa <= berth.maxLoa &&
    vessel.draft <= berth.maxDraft);

}

/** Schedule a given vessel order onto berths, returning assignments + objective. */
function schedule(
order: Vessel[],
berths: Berth[],
derived: Record<string, VesselDerived>,
settings: PortSettings)
: {assignments: Assignment[];unassigned: string[];objective: number;} {
  const free: Record<string, number> = {};
  berths.forEach((b) => {
    free[b.id] = -Infinity;
  });
  const assignments: Assignment[] = [];
  const unassigned: string[] = [];
  let objective = 0;

  for (const vessel of order) {
    const d = derived[vessel.id];
    if (!d) continue;
    const etaMs = d.eta.getTime();
    const candidates = berths.filter((b) => feasible(vessel, b));
    if (candidates.length === 0) {
      unassigned.push(vessel.id);
      objective += 500 * settings.waitingWeight;
      continue;
    }
    let best: {berth: Berth;startMs: number;wait: number;} | null = null;
    for (const berth of candidates) {
      const startMs = Math.max(etaMs, free[berth.id] === -Infinity ? etaMs : free[berth.id]);
      const wait = (startMs - etaMs) / 3600_000;
      if (!best || wait < best.wait - 1e-9) best = { berth, startMs, wait };
    }
    if (!best) continue;
    const start = new Date(best.startMs);
    const end = addHours(start, vessel.unloadingHours);
    free[best.berth.id] = end.getTime();

    const priorityFactor =
    d.priority === 'critical' ? 3 : d.priority === 'high' ? 1.8 : 1;
    let cost = best.wait * settings.waitingWeight * 1;
    cost += best.wait * settings.priorityWeight * (priorityFactor - 1);
    if (d.spoilageDeadline) {
      const slack = hoursBetween(end, d.spoilageDeadline);
      if (slack < 0) cost += -slack * settings.spoilageWeight;else
      if (slack < 6) cost += (6 - slack) * settings.spoilageWeight * 0.35;
    }
    objective += cost;

    assignments.push({
      vesselId: vessel.id,
      berthId: best.berth.id,
      start: start.toISOString(),
      end: end.toISOString(),
      waitingHours: best.wait
    });
  }

  return { assignments, unassigned, objective };
}

/**
 * Berth allocation solver. The QUBO/BQM is annealed with a metropolis
 * acceptance rule over vessel-sequence swaps — the same objective a QAOA
 * mixer would minimise, executed here on classical hardware (simulated).
 */
export function runBerthOptimization(input: SolverInput): OptimizationResult {
  const { berths, derived, settings } = input;
  const queue = input.vessels.filter(
    (v) => v.status === 'approaching' || v.status === 'waiting' || v.status === 'berthed'
  );

  // Warm start: earliest-deadline-first, then ETA.
  let order = [...queue].sort((a, b) => {
    const da = derived[a.id];
    const db = derived[b.id];
    if (!da || !db) return 0;
    const sa = da.spoilageDeadline ? da.spoilageDeadline.getTime() : Infinity;
    const sb = db.spoilageDeadline ? db.spoilageDeadline.getTime() : Infinity;
    if (sa !== sb) return sa - sb;
    return da.eta.getTime() - db.eta.getTime();
  });

  let current = schedule(order, berths, derived, settings);
  let bestOrder = order;
  let best = current;
  const trace: {iteration: number;objective: number;}[] = [];
  const iterations = Math.max(1, settings.annealIterations);
  let rng = 20260814;
  const rand = () => {
    rng = rng * 1103515245 + 12345 & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  for (let i = 0; i < iterations && order.length > 1; i++) {
    const temperature = Math.max(0.02, 1 - i / iterations);
    const a = Math.floor(rand() * order.length);
    const b = Math.floor(rand() * order.length);
    if (a === b) continue;
    const candidate = [...order];
    [candidate[a], candidate[b]] = [candidate[b], candidate[a]];
    const result = schedule(candidate, berths, derived, settings);
    const delta = result.objective - current.objective;
    if (delta < 0 || rand() < Math.exp(-delta / (temperature * 8))) {
      order = candidate;
      current = result;
      if (result.objective < best.objective) {
        best = result;
        bestOrder = candidate;
      }
    }
    if (i % Math.ceil(iterations / 40) === 0) {
      trace.push({ iteration: i, objective: Number(best.objective.toFixed(2)) });
    }
  }
  trace.push({ iteration: iterations, objective: Number(best.objective.toFixed(2)) });

  const final = schedule(bestOrder, berths, derived, settings);
  const totalWaitingHours = final.assignments.reduce((s, a) => s + a.waitingHours, 0);

  const anchorage: AnchorageEntry[] = final.assignments.
  filter((a) => a.waitingHours > 0.25).
  map((a, idx) => {
    const d = derived[a.vesselId];
    return {
      vesselId: a.vesselId,
      zone: idx % 2 === 0 ? 'ANCHORAGE ZONE A' : 'ANCHORAGE ZONE B',
      reason: `${a.berthId} occupied at ETA`,
      expectedBerthId: a.berthId,
      waitingHours: a.waitingHours,
      priority: d ? d.priority : 'standard',
      spoilageRisk: d ? d.spoilageRisk : 'none'
    };
  }).
  sort((x, y) => y.waitingHours - x.waitingHours);

  const busyHours = final.assignments.reduce(
    (s, a) => s + hoursBetween(a.start, a.end),
    0
  );
  const horizon = Math.max(
    1,
    ...final.assignments.map((a) => hoursBetween(final.assignments[0]?.start ?? a.start, a.end))
  );
  const operationalBerths = berths.filter((b) => b.status === 'operational').length || 1;
  const berthUtilization = Math.min(
    99,
    Math.round(busyHours / (horizon * operationalBerths) * 100)
  );

  const avgWait = final.assignments.length ?
  totalWaitingHours / final.assignments.length :
  0;
  const penalty = final.unassigned.length * 6;
  const score = Math.max(
    0,
    Math.min(99.9, 100 - avgWait * 3.2 - penalty - anchorage.length * 0.6)
  );

  return {
    assignments: final.assignments,
    unassigned: final.unassigned,
    anchorage,
    totalWaitingHours,
    score: Number(score.toFixed(1)),
    objectiveValue: Number(final.objective.toFixed(2)),
    iterations,
    quboVariables: quboVariableCount(queue.length, berths.length),
    constraints: constraintCount(queue.length, berths.length),
    berthUtilization,
    solvedAt: new Date().toISOString(),
    trace
  };
}

/**
 * Crane allocation: cranes belong to a berth and are assigned to whichever
 * vessel currently occupies it, splitting the vessel load across the berth's
 * available cranes and deriving utilisation from throughput capacity.
 */
export function allocateCranes(
cranes: Crane[],
assignments: Assignment[],
vessels: Vessel[],
at: Date)
: CraneAllocation[] {
  const nowMs = at.getTime();
  const activeByBerth = new Map<string, Assignment>();
  assignments.forEach((a) => {
    if (nowMs >= new Date(a.start).getTime() && nowMs < new Date(a.end).getTime()) {
      activeByBerth.set(a.berthId, a);
    }
  });

  return cranes.map((crane) => {
    if (crane.status === 'maintenance') {
      return {
        craneId: crane.id,
        berthId: crane.berthId,
        vesselId: null,
        assignedTonnes: 0,
        utilization: 0,
        status: 'maintenance' as const
      };
    }
    const assignment = activeByBerth.get(crane.berthId);
    if (!assignment) {
      return {
        craneId: crane.id,
        berthId: crane.berthId,
        vesselId: null,
        assignedTonnes: 0,
        utilization: 0,
        status: 'available' as const
      };
    }
    const vessel = vessels.find((v) => v.id === assignment.vesselId);
    if (!vessel) {
      return {
        craneId: crane.id,
        berthId: crane.berthId,
        vesselId: null,
        assignedTonnes: 0,
        utilization: 0,
        status: 'available' as const
      };
    }
    const berthCranes = cranes.filter(
      (c) => c.berthId === crane.berthId && c.status === 'operational'
    );
    const share = vessel.loadTonnes / Math.max(1, berthCranes.length);
    const requiredTph = share / Math.max(0.5, vessel.unloadingHours);
    const utilization = Math.min(
      100,
      Math.round(requiredTph / crane.capacityTph * 100)
    );
    return {
      craneId: crane.id,
      berthId: crane.berthId,
      vesselId: vessel.id,
      assignedTonnes: Math.round(share),
      utilization,
      status: 'active' as const
    };
  });
}