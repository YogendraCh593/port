"""
NexusPort – Dynamic Hybrid Classical + QAOA Optimization Engine
================================================================
This module implements the full scheduling pipeline described in the spec.
It is imported by main.py and exposed via new API endpoints.

Architecture
───────────
  Ship data + port state
        ↓
  Dynamic ETA + processing time calculation (crane-aware)
        ↓
  Berth/crane compatibility filter
        ↓
  Generate feasible assignment candidates
        ↓
  Classical schedulers (FCFS / SJF / SRPT / Greedy)  ←──┐
        +                                                  │ compare
  QAOA / Hybrid optimizer                            ←──┘
        ↓
  Select best feasible solution (lowest objective)
        ↓
  Execute schedule, produce event log + "why" explanations
        ↓
  Rolling-horizon: re-optimize on every trigger event
"""
from __future__ import annotations

import math
import time
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# CONSTANTS & DEFAULTS
# ---------------------------------------------------------------------------
DEFAULT_CRANE_RATE_TPM   = 10.0    # tonnes per minute per crane
DEFAULT_EFFICIENCY       = 0.90    # multi-crane efficiency factor
DEFAULT_SWITCH_COST_MIN  = 5.0     # crane preemption switching cost (minutes)
DEFAULT_AGING_RATE       = 0.05    # fairness aging: priority += rate * wait_minutes
MAX_WAIT_BEFORE_FORCE    = 180.0   # minutes: ship cannot wait longer than this
QAOA_MAX_VARS            = 14      # statevector limit before classical fallback


# ---------------------------------------------------------------------------
# DATA CLASSES  (plain dicts for JSON-serializability)
# ---------------------------------------------------------------------------

def make_ship_state(
    ship_id: str,
    operator: str,
    cargo_type: str,
    original_cargo_t: float,
    remaining_cargo_t: float,
    processed_cargo_t: float,
    loa_m: float,
    draft_m: float,
    berth: Optional[str],
    cranes: List[str],
    status: str,                  # approaching / waiting / servicing / departed / halted
    arrival_time: str,
    eta: str,
    start_processing: Optional[str],
    predicted_completion: Optional[str],
    predicted_departure: Optional[str],
    waiting_time_min: float,
    num_preemptions: int,
    processing_rate_tpm: float,
) -> Dict[str, Any]:
    return {k: v for k, v in locals().items()}


def make_crane_state(
    crane_id: str,
    current_ship: Optional[str],
    available: bool,
    handling_rate_tpm: float,
    utilization_pct: float,
    switching: bool,
    switch_remaining_min: float,
) -> Dict[str, Any]:
    return {k: v for k, v in locals().items()}


def make_berth_state(
    berth_id: str,
    current_ship: Optional[str],
    available: bool,
    capacity_t: float,
    max_loa: float,
    max_draft: float,
    occupancy_start: Optional[str],
) -> Dict[str, Any]:
    return {k: v for k, v in locals().items()}


def make_event(
    timestamp: str,
    event_type: str,
    description: str,
    ship_id: Optional[str] = None,
    berth_id: Optional[str] = None,
    crane_id: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
) -> Dict[str, Any]:
    return {k: v for k, v in locals().items()}


# ---------------------------------------------------------------------------
# PROCESSING TIME CALCULATOR
# ---------------------------------------------------------------------------

def calc_processing_time_min(
    remaining_cargo_t: float,
    crane_count: int,
    base_rate_tpm: float = DEFAULT_CRANE_RATE_TPM,
    efficiency: float    = DEFAULT_EFFICIENCY,
) -> float:
    """
    ProcessingTime = RemainingCargo / (BaseRate × CraneCount × Efficiency)
    100 t, 1 crane, 10 tpm → 10 min
    500 t, 1 crane, 10 tpm → 50 min
    1000 t, 2 cranes, 10 tpm, 0.9 eff → 1000/(10×2×0.9) ≈ 55.6 min
    """
    if crane_count < 1:
        crane_count = 1
    eff_rate = base_rate_tpm * crane_count * efficiency
    return remaining_cargo_t / max(eff_rate, 0.001)


def predicted_departure(
    service_start: datetime,
    remaining_cargo_t: float,
    crane_count: int,
    base_rate_tpm: float = DEFAULT_CRANE_RATE_TPM,
    efficiency: float    = DEFAULT_EFFICIENCY,
    preemption_overhead_min: float = 0.0,
    emergency_delay_min: float = 0.0,
) -> datetime:
    proc_min = calc_processing_time_min(remaining_cargo_t, crane_count, base_rate_tpm, efficiency)
    total_min = proc_min + preemption_overhead_min + emergency_delay_min
    return service_start + timedelta(minutes=total_min)


# ---------------------------------------------------------------------------
# BERTH COMPATIBILITY (physical only — no cargo type restriction)
# ---------------------------------------------------------------------------

def berth_compatible(ship: Dict[str, Any], berth: Dict[str, Any]) -> Tuple[bool, List[str]]:
    reasons: List[str] = []
    if float(ship.get("weight_tonnes", 0)) > float(berth.get("capacity_tonnes", 999_999)):
        reasons.append(f"load {ship['weight_tonnes']}t > berth capacity {berth['capacity_tonnes']}t")
    if float(ship.get("loa_m", 0)) > float(berth.get("max_loa_m", 999)):
        reasons.append(f"LOA {ship['loa_m']}m > berth max {berth['max_loa_m']}m")
    if float(ship.get("draft_m", 0)) > float(berth.get("max_draft_m", 99)):
        reasons.append(f"draft {ship['draft_m']}m > berth max {berth['max_draft_m']}m")
    return len(reasons) == 0, reasons


# ---------------------------------------------------------------------------
# OBJECTIVE FUNCTION (used by all schedulers and QAOA)
# ---------------------------------------------------------------------------

class ObjectiveWeights:
    waiting      = 4.0
    departure_delay = 3.0
    crane_idle   = 2.0
    crane_switch = 1.5
    berth_idle   = 1.0
    fairness     = 2.0
    imbalance    = 1.0


def compute_objective(schedule: List[Dict[str, Any]], weights: ObjectiveWeights = None) -> float:
    """
    Compute the global objective value for a complete schedule.
    Lower is better.
    """
    if weights is None:
        weights = ObjectiveWeights()
    total = 0.0
    crane_loads: Dict[str, float] = {}

    for entry in schedule:
        wait   = float(entry.get("wait_min", 0))
        depart = float(entry.get("departure_delay_min", 0))
        idle   = float(entry.get("crane_idle_min", 0))
        switch = float(entry.get("switch_cost_min", 0))
        bidle  = float(entry.get("berth_idle_min", 0))
        fair   = float(entry.get("fairness_penalty", 0))

        total += (weights.waiting * wait
                  + weights.departure_delay * depart
                  + weights.crane_idle * idle
                  + weights.crane_switch * switch
                  + weights.berth_idle * bidle
                  + weights.fairness * fair)

        c = entry.get("crane_id")
        if c:
            crane_loads[c] = crane_loads.get(c, 0) + float(entry.get("processing_time_min", 0))

    # Crane imbalance penalty
    if len(crane_loads) > 1:
        vals   = list(crane_loads.values())
        mean   = sum(vals) / len(vals)
        stddev = math.sqrt(sum((x - mean) ** 2 for x in vals) / len(vals))
        total += weights.imbalance * stddev

    return total


# ---------------------------------------------------------------------------
# CLASSICAL SCHEDULERS
# ---------------------------------------------------------------------------

def _eta_ms(ship: Dict[str, Any]) -> float:
    eta = ship.get("eta") or ship.get("start_dt") or ship.get("departure")
    if isinstance(eta, datetime):
        return eta.timestamp() * 1000
    if isinstance(eta, str):
        try:
            return datetime.fromisoformat(eta).timestamp() * 1000
        except Exception:
            pass
    return 0.0


def _remaining_proc_min(
    ship: Dict[str, Any],
    crane_count: int,
    rate_tpm: float,
    eff: float,
) -> float:
    rem = float(ship.get("remaining_cargo_t", ship.get("weight_tonnes", 0)))
    return calc_processing_time_min(rem, crane_count, rate_tpm, eff)


def schedule_fcfs(ships, berths, crane_count, rate_tpm, eff, switch_cost, aging_rate) -> List[Dict]:
    """First Come First Served — ETA order."""
    ordered = sorted(ships, key=lambda s: _eta_ms(s))
    return _assign_ordered(ordered, berths, crane_count, rate_tpm, eff, switch_cost, "FCFS")


def schedule_sjf(ships, berths, crane_count, rate_tpm, eff, switch_cost, aging_rate) -> List[Dict]:
    """Shortest Job First — sort by original cargo ascending."""
    ordered = sorted(ships, key=lambda s: float(s.get("weight_tonnes", 0)))
    return _assign_ordered(ordered, berths, crane_count, rate_tpm, eff, switch_cost, "SJF")


def schedule_srpt(ships, berths, crane_count, rate_tpm, eff, switch_cost, aging_rate) -> List[Dict]:
    """Shortest Remaining Processing Time."""
    ordered = sorted(ships, key=lambda s: _remaining_proc_min(s, crane_count, rate_tpm, eff))
    return _assign_ordered(ordered, berths, crane_count, rate_tpm, eff, switch_cost, "SRPT")


def schedule_greedy(ships, berths, crane_count, rate_tpm, eff, switch_cost, aging_rate) -> List[Dict]:
    """
    Greedy priority with aging/fairness.
    Priority = base_score + aging_rate × waiting_min
    Base score uses weighted combination of ETA, remaining cargo, spoilability.
    Starvation prevention: waiting > MAX_WAIT_BEFORE_FORCE forces immediate allocation.
    """
    now_ms = datetime.now().timestamp() * 1000

    def priority(s):
        eta_ms  = _eta_ms(s)
        wait    = max(0.0, (now_ms - eta_ms) / 60_000)  # minutes waiting
        rem     = _remaining_proc_min(s, crane_count, rate_tpm, eff)
        spoil   = 5.0 if s.get("spoilable") else 0.0
        forced  = -1e9 if wait >= MAX_WAIT_BEFORE_FORCE else 0.0
        base    = rem + spoil
        return base - aging_rate * wait + forced

    ordered = sorted(ships, key=priority)
    return _assign_ordered(ordered, berths, crane_count, rate_tpm, eff, switch_cost, "Greedy")


def _assign_ordered(
    ships: List[Dict],
    berths: List[Dict],
    crane_count: int,
    rate_tpm: float,
    eff: float,
    switch_cost: float,
    algo_name: str,
) -> List[Dict]:
    """
    Assign ships in the given order to the best available compatible berth.
    Returns a list of schedule entries.
    """
    berth_free: Dict[str, float] = {b["name"]: 0.0 for b in berths}  # ms
    crane_free: List[float] = [0.0] * max(crane_count, 1)

    results: List[Dict] = []
    for ship in ships:
        eta_ms = _eta_ms(ship)
        rem_t  = float(ship.get("remaining_cargo_t", ship.get("weight_tonnes", 0)))

        # Find compatible berths
        fits = [b for b in berths if berth_compatible(ship, b)[0]]
        if not fits:
            results.append({
                "ship_id":           ship["ship_id"],
                "berth_id":          None,
                "crane_id":          None,
                "algo":              algo_name,
                "compatible":        False,
                "wait_min":          0,
                "processing_time_min": 0,
                "service_start_ms":  eta_ms,
                "service_end_ms":    eta_ms,
                "departure_delay_min": 0,
                "crane_idle_min":    0,
                "switch_cost_min":   0,
                "berth_idle_min":    0,
                "fairness_penalty":  0,
                "reason":            f"No berth fits: {', '.join([berth_compatible(ship, b)[1][0] if not berth_compatible(ship, b)[0] else '' for b in berths[:3]])}",
                "remaining_cargo_t": rem_t,
                "predicted_departure": None,
            })
            continue

        # Best berth: earliest free among compatible
        best_berth   = min(fits, key=lambda b: berth_free[b["name"]])
        berth_start  = max(eta_ms, berth_free[best_berth["name"]])
        berth_idle   = max(0.0, (berth_start - berth_free[best_berth["name"]]) / 60_000)
        wait_min     = max(0.0, (berth_start - eta_ms) / 60_000)

        # Assign earliest free crane
        crane_idx    = int(np.argmin(crane_free))
        crane_start  = max(berth_start, crane_free[crane_idx])
        crane_idle   = max(0.0, (crane_start - crane_free[crane_idx]) / 60_000)

        proc_min     = calc_processing_time_min(rem_t, 1, rate_tpm, eff)  # 1 crane per berth
        service_end  = crane_start + proc_min * 60_000

        berth_free[best_berth["name"]] = service_end
        crane_free[crane_idx]          = service_end

        # Build reason string for "why this decision"
        reason_parts = [
            f"Compatible dimensions (load, LOA, draft)",
            f"Earliest available berth among {len(fits)} compatible",
            f"Crane C{crane_idx+1} assigned (least loaded)",
        ]
        if wait_min > 0:
            reason_parts.append(f"Waited {wait_min:.1f} min for berth to free up")

        results.append({
            "ship_id":             ship["ship_id"],
            "berth_id":            best_berth["name"],
            "crane_id":            f"Crane {crane_idx+1}",
            "algo":                algo_name,
            "compatible":          True,
            "wait_min":            round(wait_min, 2),
            "processing_time_min": round(proc_min, 2),
            "service_start_ms":    berth_start,
            "service_end_ms":      service_end,
            "departure_delay_min": 0.0,
            "crane_idle_min":      round(crane_idle, 2),
            "switch_cost_min":     0.0,
            "berth_idle_min":      round(berth_idle, 2),
            "fairness_penalty":    max(0.0, wait_min - MAX_WAIT_BEFORE_FORCE),
            "reason":              " · ".join(reason_parts),
            "remaining_cargo_t":   rem_t,
            "predicted_departure": datetime.fromtimestamp(service_end / 1000).isoformat(),
        })

    return results


# ---------------------------------------------------------------------------
# QAOA OPTIMIZER  (genuine QUBO / statevector QAOA)
# ---------------------------------------------------------------------------

def _build_qubo(
    ships: List[Dict],
    berths: List[Dict],
    crane_count: int,
    rate_tpm: float,
    eff: float,
    switch_cost: float,
    weights: ObjectiveWeights,
) -> Tuple[List[Tuple[str, str]], np.ndarray, Dict]:
    """
    Build a QUBO for the joint berth + crane assignment problem.

    Binary variables:
      x[i,j] = 1  if ship i → berth j
      y[i,k] = 1  if ship i → crane k

    Returns (variables, Q_matrix, metadata)
    """
    n_ships  = len(ships)
    n_berths = len(berths)
    n_cranes = max(crane_count, 1)

    # Build variable list: (type, ship_idx, resource_idx)
    vars_x: List[Tuple[str, int, int]] = []   # berth assignment
    vars_y: List[Tuple[str, int, int]] = []   # crane assignment

    for i in range(n_ships):
        for j in range(n_berths):
            vars_x.append(("x", i, j))
        for k in range(n_cranes):
            vars_y.append(("y", i, k))

    all_vars = vars_x + vars_y
    n = len(all_vars)
    Q = np.zeros((n, n), dtype=float)
    var_idx = {v: i for i, v in enumerate(all_vars)}

    # Pre-compute ETAs in ms
    eta_ms_list = [_eta_ms(s) for s in ships]
    berth_capacity = [float(b.get("capacity_tonnes", 999_999)) for b in berths]

    # --- Objective terms ---
    for i, ship in enumerate(ships):
        rem_t  = float(ship.get("remaining_cargo_t", ship.get("weight_tonnes", 0)))
        eta_i  = eta_ms_list[i]

        for j, berth in enumerate(berths):
            xi = var_idx[("x", i, j)]
            ok, _ = berth_compatible(ship, berth)
            if not ok:
                # Hard penalty for infeasible assignment
                Q[xi, xi] += 1000.0
                continue

            proc_min = calc_processing_time_min(rem_t, 1, rate_tpm, eff)
            # Approximate wait cost (linear in queue position)
            wait_penalty = weights.waiting * (j * 0.5)
            Q[xi, xi] += wait_penalty + weights.departure_delay * proc_min * 0.01

        for k in range(n_cranes):
            yk = var_idx[("y", i, k)]
            proc_min = calc_processing_time_min(rem_t, 1, rate_tpm, eff)
            Q[yk, yk] += weights.crane_idle * 0.1 + weights.crane_switch * switch_cost * 0.01

    # --- One-hot constraints: each ship must go to exactly one berth ---
    PENALTY = 20.0
    for i in range(n_ships):
        # Sum_j x[i,j] = 1  →  penalty*(1 - sum)^2
        # Diagonal: -PENALTY, Cross: +2*PENALTY
        for j in range(n_berths):
            xi = var_idx[("x", i, j)]
            Q[xi, xi] += -PENALTY
            for j2 in range(j + 1, n_berths):
                xi2 = var_idx[("x", i, j2)]
                Q[xi, xi2] += 2 * PENALTY

    # --- One-hot: each ship must get exactly one crane ---
    for i in range(n_ships):
        for k in range(n_cranes):
            yk = var_idx[("y", i, k)]
            Q[yk, yk] += -PENALTY
            for k2 in range(k + 1, n_cranes):
                yk2 = var_idx[("y", i, k2)]
                Q[yk, yk2] += 2 * PENALTY

    # --- Berth conflict: no two ships at same berth simultaneously ---
    # Approximate: penalise assigning ships at similar ETAs to same berth
    CONFLICT = 15.0
    for j in range(n_berths):
        for i in range(n_ships):
            for i2 in range(i + 1, n_ships):
                xi  = var_idx[("x", i,  j)]
                xi2 = var_idx[("x", i2, j)]
                Q[xi, xi2] += CONFLICT

    meta = {
        "n_vars":   n,
        "n_ships":  n_ships,
        "n_berths": n_berths,
        "n_cranes": n_cranes,
        "vars":     [str(v) for v in all_vars],
    }
    return all_vars, Q, meta


def _qaoa_simulate(
    Q: np.ndarray,
    n: int,
    greedy_state: int,
    n_layers: int = 1,
    n_gamma: int  = 6,
    n_beta:  int  = 6,
) -> Tuple[np.ndarray, float]:
    """
    Genuine QAOA statevector simulation.
    Returns (best_state_probs, best_expected_value).
    """
    dim    = 1 << n
    # Diagonal cost from QUBO
    costs  = np.zeros(dim, dtype=float)
    for state in range(dim):
        bits = [(state >> q) & 1 for q in range(n)]
        x    = np.array(bits, dtype=float)
        costs[state] = float(x @ Q @ x)

    # Normalise costs to [0,1]
    c_min, c_max = costs.min(), costs.max()
    if c_max > c_min:
        costs_n = (costs - c_min) / (c_max - c_min)
    else:
        costs_n = costs.copy()

    # Warm-start from greedy solution
    psi  = np.ones(dim, dtype=complex) * 0.25 / np.sqrt(dim)
    psi[greedy_state] += 0.75
    psi /= np.linalg.norm(psi)

    best_exp   = float("inf")
    best_probs = np.abs(psi) ** 2

    for gamma in np.linspace(0.1, 1.8, n_gamma):
        for beta in np.linspace(0.1, 1.8, n_beta):
            p = psi.copy()
            # Phase separation (cost Hamiltonian)
            p *= np.exp(-1j * gamma * costs_n)
            # Mixing (X-mixer per qubit)
            cb, sb = np.cos(beta), -1j * np.sin(beta)
            for q in range(n):
                step = 1 << q
                for base in range(0, dim, 2 * step):
                    for off in range(step):
                        a_i, b_i = base + off, base + off + step
                        va, vb   = p[a_i], p[b_i]
                        p[a_i]   = cb * va + sb * vb
                        p[b_i]   = sb * va + cb * vb
            exp_val = float(np.sum(np.abs(p) ** 2 * costs_n))
            if exp_val < best_exp:
                best_exp   = exp_val
                best_probs = np.abs(p) ** 2

    return best_probs, best_exp


def _decode_qaoa(
    probs: np.ndarray,
    all_vars: List[Tuple],
    ships: List[Dict],
    berths: List[Dict],
    crane_count: int,
    n_samples: int = 20,
) -> Optional[Dict[str, Any]]:
    """
    Decode the QAOA probability distribution into a feasible assignment.
    Tries the top-n_samples states by probability, returns the best feasible one.
    """
    n_ships  = len(ships)
    n_berths = len(berths)
    n_cranes = max(crane_count, 1)
    n_vars   = len(all_vars)

    ranked = np.argsort(-probs)

    for state_idx in ranked[:n_samples]:
        berth_assign: Dict[int, int] = {}
        crane_assign: Dict[int, int] = {}
        valid = True

        for var_idx, var in enumerate(all_vars):
            bit = (int(state_idx) >> var_idx) & 1
            if bit == 0:
                continue
            vtype, i, r = var
            if vtype == "x":
                if i in berth_assign:
                    valid = False; break
                berth_assign[i] = r
            else:
                if i in crane_assign:
                    valid = False; break
                crane_assign[i] = r

        if not valid:
            continue
        if len(berth_assign) != n_ships:
            continue

        # Validate physical constraints
        feasible = True
        for i, j in berth_assign.items():
            ok, _ = berth_compatible(ships[i], berths[j])
            if not ok:
                feasible = False; break
        if not feasible:
            continue

        return {"berth": berth_assign, "crane": crane_assign, "state": int(state_idx)}

    return None


def schedule_qaoa(
    ships: List[Dict],
    berths: List[Dict],
    crane_count: int,
    rate_tpm: float,
    eff: float,
    switch_cost: float,
    weights: ObjectiveWeights,
) -> Tuple[List[Dict], Dict[str, Any]]:
    """
    Run genuine QAOA optimizer.
    Returns (schedule_entries, qaoa_metadata).
    """
    t0 = time.time()

    # Fallback to classical for large fleets
    if len(ships) * (len(berths) + crane_count) > QAOA_MAX_VARS:
        entries = schedule_greedy(ships, berths, crane_count, rate_tpm, eff, switch_cost, DEFAULT_AGING_RATE)
        for e in entries:
            e["algo"] = "Classical (QAOA fallback — fleet too large)"
        return entries, {
            "mode": "classical_fallback",
            "reason": f"Variables ({len(ships) * (len(berths) + crane_count)}) > {QAOA_MAX_VARS}",
            "runtime_s": round(time.time() - t0, 3),
        }

    all_vars, Q, meta = _build_qubo(ships, berths, crane_count, rate_tpm, eff, switch_cost, weights)
    n = meta["n_vars"]

    # Greedy warm-start state
    greedy_entries = schedule_greedy(ships, berths, crane_count, rate_tpm, eff, switch_cost, DEFAULT_AGING_RATE)
    ship_to_berth  = {e["ship_id"]: e["berth_id"] for e in greedy_entries if e.get("berth_id")}
    greedy_state   = 0
    for i, ship in enumerate(ships):
        for j, berth in enumerate(berths):
            if ship_to_berth.get(ship["ship_id"]) == berth["name"]:
                var_key = ("x", i, j)
                bit_pos = next((idx for idx, v in enumerate(all_vars) if v == var_key), None)
                if bit_pos is not None:
                    greedy_state |= (1 << bit_pos)

    probs, best_exp = _qaoa_simulate(Q, n, greedy_state)
    qaoa_result     = _decode_qaoa(probs, all_vars, ships, berths, crane_count)

    qaoa_runtime = round(time.time() - t0, 3)
    meta.update({
        "runtime_s":       qaoa_runtime,
        "best_expected":   round(float(best_exp), 4),
        "mode":            "QAOA statevector",
        "layers":          1,
        "greedy_state":    greedy_state,
    })

    if qaoa_result is None:
        # QAOA found no feasible solution → use greedy
        for e in greedy_entries:
            e["algo"] = "QAOA (infeasible → classical fallback)"
        meta["decoded"] = "infeasible"
        return greedy_entries, meta

    # Build schedule entries from decoded solution
    berth_free: Dict[int, float] = {}
    crane_free: List[float] = [0.0] * max(crane_count, 1)
    entries: List[Dict] = []

    ship_order = sorted(
        range(len(ships)),
        key=lambda i: _eta_ms(ships[i]),
    )

    for i in ship_order:
        ship    = ships[i]
        eta_ms  = _eta_ms(ship)
        rem_t   = float(ship.get("remaining_cargo_t", ship.get("weight_tonnes", 0)))
        j       = qaoa_result["berth"].get(i)
        k       = qaoa_result["crane"].get(i, 0)

        if j is None or j >= len(berths):
            entries.append({
                "ship_id": ship["ship_id"], "berth_id": None, "crane_id": None,
                "algo": "QAOA", "compatible": False, "wait_min": 0,
                "processing_time_min": 0, "service_start_ms": eta_ms,
                "service_end_ms": eta_ms, "departure_delay_min": 0,
                "crane_idle_min": 0, "switch_cost_min": 0, "berth_idle_min": 0,
                "fairness_penalty": 0, "reason": "QAOA could not assign berth",
                "remaining_cargo_t": rem_t, "predicted_departure": None,
            })
            continue

        berth       = berths[j]
        berth_avail = berth_free.get(j, 0.0)
        start_ms    = max(eta_ms, berth_avail)
        wait_min    = max(0.0, (start_ms - eta_ms) / 60_000)
        proc_min    = calc_processing_time_min(rem_t, 1, rate_tpm, eff)
        end_ms      = start_ms + proc_min * 60_000
        berth_free[j] = end_ms
        crane_free[k % crane_count] = end_ms

        reason_parts = [
            f"QAOA selected berth {berth['name']} (QUBO optimized)",
            f"Compatible: load/LOA/draft within limits",
            f"Crane C{k+1} allocated",
            f"QAOA expected value: {best_exp:.4f}",
        ]

        entries.append({
            "ship_id":             ship["ship_id"],
            "berth_id":            berth["name"],
            "crane_id":            f"Crane {k+1}",
            "algo":                "QAOA",
            "compatible":          True,
            "wait_min":            round(wait_min, 2),
            "processing_time_min": round(proc_min, 2),
            "service_start_ms":    start_ms,
            "service_end_ms":      end_ms,
            "departure_delay_min": 0.0,
            "crane_idle_min":      0.0,
            "switch_cost_min":     0.0,
            "berth_idle_min":      0.0,
            "fairness_penalty":    0.0,
            "reason":              " · ".join(reason_parts),
            "remaining_cargo_t":   rem_t,
            "predicted_departure": datetime.fromtimestamp(end_ms / 1000).isoformat(),
        })

    meta["objective_qaoa"]      = round(compute_objective(entries, weights), 4)
    meta["objective_classical"] = round(compute_objective(greedy_entries, weights), 4)
    meta["decoded"] = "feasible"
    return entries, meta


# ---------------------------------------------------------------------------
# HYBRID OPTIMIZER
# ---------------------------------------------------------------------------

def schedule_hybrid(
    ships: List[Dict],
    berths: List[Dict],
    crane_count: int,
    rate_tpm: float,
    eff: float,
    switch_cost: float,
    aging_rate: float,
    weights: ObjectiveWeights,
) -> Tuple[List[Dict], Dict[str, Any]]:
    """
    Run classical + QAOA, pick whichever has the lower objective value.
    """
    t0 = time.time()

    # Classical candidates
    classical_results = {
        "FCFS":    schedule_fcfs(ships, berths, crane_count, rate_tpm, eff, switch_cost, aging_rate),
        "SJF":     schedule_sjf(ships, berths, crane_count, rate_tpm, eff, switch_cost, aging_rate),
        "SRPT":    schedule_srpt(ships, berths, crane_count, rate_tpm, eff, switch_cost, aging_rate),
        "Greedy":  schedule_greedy(ships, berths, crane_count, rate_tpm, eff, switch_cost, aging_rate),
    }
    classical_obj = {name: compute_objective(sched, weights) for name, sched in classical_results.items()}
    best_classical_name = min(classical_obj, key=lambda k: classical_obj[k])
    best_classical      = classical_results[best_classical_name]
    best_classical_obj  = classical_obj[best_classical_name]

    # QAOA
    qaoa_entries, qaoa_meta = schedule_qaoa(ships, berths, crane_count, rate_tpm, eff, switch_cost, weights)
    qaoa_obj = compute_objective(qaoa_entries, weights)

    runtime = round(time.time() - t0, 3)

    comparison = {
        "FCFS":    round(classical_obj["FCFS"], 4),
        "SJF":     round(classical_obj["SJF"],  4),
        "SRPT":    round(classical_obj["SRPT"], 4),
        "Greedy":  round(classical_obj["Greedy"], 4),
        "QAOA":    round(qaoa_obj, 4),
    }

    if qaoa_obj < best_classical_obj:
        winner      = "QAOA"
        best_sched  = qaoa_entries
        best_obj    = qaoa_obj
    else:
        winner      = best_classical_name
        best_sched  = best_classical
        best_obj    = best_classical_obj
        for e in best_sched:
            e["algo"] = f"Hybrid → {best_classical_name}"

    meta = {
        "mode":                "Hybrid Classical + QAOA",
        "winner":              winner,
        "best_objective":      round(best_obj, 4),
        "comparison":          comparison,
        "runtime_s":           runtime,
        "qaoa_meta":           qaoa_meta,
        "selected_classical":  best_classical_name,
    }
    return best_sched, meta


# ---------------------------------------------------------------------------
# PREEMPTION EVALUATOR
# ---------------------------------------------------------------------------

def evaluate_preemption(
    current_ship: Dict,
    new_ship: Dict,
    switch_cost_min: float,
    rate_tpm: float,
    eff: float,
    weights: ObjectiveWeights,
) -> Tuple[bool, str]:
    """
    Evaluate whether preempting current_ship in favour of new_ship
    improves the global objective.

    Returns (should_preempt, reason).
    """
    rem_current = float(current_ship.get("remaining_cargo_t", 0))
    rem_new     = float(new_ship.get("weight_tonnes", 0))

    t_current = calc_processing_time_min(rem_current, 1, rate_tpm, eff)
    t_new     = calc_processing_time_min(rem_new, 1, rate_tpm, eff)

    # Without preemption: current finishes, then new
    obj_no_preempt = (
        weights.departure_delay * t_current
        + weights.waiting * (t_current + t_new)
    )

    # With preemption: new first, then resume current + switch overhead
    t_current_after = t_current  # remaining after switch
    obj_preempt = (
        weights.crane_switch * switch_cost_min * 2       # two switches
        + weights.departure_delay * (t_new + switch_cost_min)
        + weights.departure_delay * (t_new + switch_cost_min + t_current_after)
        + weights.waiting * t_new
    )

    if obj_preempt < obj_no_preempt * 0.90:   # 10% improvement threshold
        reason = (
            f"Preemption saves {obj_no_preempt - obj_preempt:.2f} objective units. "
            f"New ship: {rem_new:.0f}t ({t_new:.1f}min). "
            f"Switch cost: {switch_cost_min}min. Beneficial."
        )
        return True, reason
    else:
        reason = (
            f"Preemption NOT beneficial. "
            f"Current ship {rem_current:.0f}t ({t_current:.1f}min remaining). "
            f"Switch overhead ({switch_cost_min}min) negates gain."
        )
        return False, reason


# ---------------------------------------------------------------------------
# ROLLING HORIZON ENGINE
# ---------------------------------------------------------------------------

class RollingHorizonEngine:
    """
    Maintains live port state and re-optimizes on trigger events.
    All state is kept in-memory; the frontend polls /optimization/live-state.
    """

    def __init__(self):
        self.reset()

    def reset(self):
        self.ship_states:  Dict[str, Dict] = {}
        self.berth_states: Dict[str, Dict] = {}
        self.crane_states: Dict[str, Dict] = {}
        self.schedule:     List[Dict]      = []
        self.event_log:    List[Dict]      = []
        self.meta:         Dict[str, Any]  = {}
        self.opt_config:   Dict[str, Any]  = {
            "algo":           "Hybrid",
            "crane_rate_tpm": DEFAULT_CRANE_RATE_TPM,
            "efficiency":     DEFAULT_EFFICIENCY,
            "switch_cost":    DEFAULT_SWITCH_COST_MIN,
            "aging_rate":     DEFAULT_AGING_RATE,
            "preemption":     True,
            "rolling":        True,
            "qaoa_enabled":   True,
        }
        self._last_optimize_time: Optional[datetime] = None

    def configure(self, config: Dict[str, Any]):
        self.opt_config.update(config)
        self._log(
            "CONFIG",
            f"Optimizer configured: algo={config.get('algo','—')}, "
            f"crane_rate={config.get('crane_rate_tpm','—')} tpm, "
            f"preemption={config.get('preemption','—')}",
        )

    def _log(self, event_type: str, description: str,
             ship_id=None, berth_id=None, crane_id=None,
             old_value=None, new_value=None):
        self.event_log.append(make_event(
            timestamp   = datetime.now().isoformat(timespec="seconds"),
            event_type  = event_type,
            description = description,
            ship_id     = ship_id,
            berth_id    = berth_id,
            crane_id    = crane_id,
            old_value   = old_value,
            new_value   = new_value,
        ))

    def load_ships(self, ship_details: List[Dict], port_profiles: Dict[str, Any]):
        """Ingest ship details from the existing registration system."""
        for ship in ship_details:
            sid = ship["ship_id"]
            cargo = float(ship.get("weight_tonnes", 0))
            self.ship_states[sid] = {
                "ship_id":             sid,
                "operator":            ship.get("operator", "—"),
                "cargo_type":          ship.get("cargo_type", "—"),
                "original_cargo_t":    cargo,
                "remaining_cargo_t":   cargo,
                "processed_cargo_t":   0.0,
                "loa_m":               float(ship.get("loa_m", 0)),
                "draft_m":             float(ship.get("draft_m", 0)),
                "weight_tonnes":       cargo,  # keep for compat
                "berth":               None,
                "cranes":              [],
                "status":              "approaching",
                "arrival_time":        ship.get("eta") or ship.get("start_dt"),
                "eta":                 ship.get("eta") or ship.get("start_dt"),
                "start_dt":            ship.get("start_dt"),
                "start_processing":    None,
                "predicted_completion": None,
                "predicted_departure": None,
                "waiting_time_min":    0.0,
                "num_preemptions":     0,
                "processing_rate_tpm": float(self.opt_config["crane_rate_tpm"]),
                "halted":              ship.get("halted", False),
                "halt_hours":          float(ship.get("halt_hours", 0)),
                "spoilable":           ship.get("spoilable", False),
                "spoilage_deadline":   ship.get("spoilage_deadline"),
                "latitude":            ship.get("latitude", 0),
                "longitude":           ship.get("longitude", 0),
                "speed_knots":         ship.get("speed_knots", 12),
            }
            self._log("SHIP_LOADED", f"Ship {sid} loaded: {cargo:.0f}t", ship_id=sid)

        # Berth states from port profiles
        for bname, bprofile in port_profiles.items():
            self.berth_states[bname] = make_berth_state(
                berth_id    = bname,
                current_ship= None,
                available   = True,
                capacity_t  = float(bprofile.get("capacity_tonnes", 999_999)),
                max_loa     = float(bprofile.get("max_loa_m", 999)),
                max_draft   = float(bprofile.get("max_draft_m", 99)),
                occupancy_start = None,
            )

        crane_count = int(self.opt_config.get("crane_count", 4))
        rate        = float(self.opt_config["crane_rate_tpm"])
        for k in range(crane_count):
            cid = f"Crane {k+1}"
            self.crane_states[cid] = make_crane_state(
                crane_id     = cid,
                current_ship = None,
                available    = True,
                handling_rate_tpm = rate,
                utilization_pct   = 0.0,
                switching         = False,
                switch_remaining_min = 0.0,
            )

    def optimize(self, algo: Optional[str] = None) -> Dict[str, Any]:
        """Run the selected optimizer and update internal schedule."""
        algo      = algo or self.opt_config.get("algo", "Hybrid")
        rate      = float(self.opt_config["crane_rate_tpm"])
        eff       = float(self.opt_config["efficiency"])
        switch    = float(self.opt_config["switch_cost"])
        aging     = float(self.opt_config["aging_rate"])
        cranes    = max(1, len(self.crane_states))
        weights   = ObjectiveWeights()

        active_ships = [
            s for s in self.ship_states.values()
            if s["status"] not in ("departed",)
        ]
        berths_list  = [
            {
                "name":             bid,
                "capacity_tonnes":  bs["capacity_t"],
                "max_loa_m":        bs["max_loa"],
                "max_draft_m":      bs["max_draft"],
            }
            for bid, bs in self.berth_states.items()
        ]

        t0 = time.time()
        meta: Dict[str, Any] = {}

        if algo == "FCFS":
            sched = schedule_fcfs(active_ships, berths_list, cranes, rate, eff, switch, aging)
        elif algo == "SJF":
            sched = schedule_sjf(active_ships, berths_list, cranes, rate, eff, switch, aging)
        elif algo == "SRPT":
            sched = schedule_srpt(active_ships, berths_list, cranes, rate, eff, switch, aging)
        elif algo == "Greedy":
            sched = schedule_greedy(active_ships, berths_list, cranes, rate, eff, switch, aging)
        elif algo == "QAOA":
            sched, meta = schedule_qaoa(active_ships, berths_list, cranes, rate, eff, switch, weights)
        else:  # Hybrid (default)
            sched, meta = schedule_hybrid(active_ships, berths_list, cranes, rate, eff, switch, aging, weights)

        obj    = compute_objective(sched, weights)
        runtime = round(time.time() - t0, 3)

        self.schedule = sched
        self.meta = {
            "algo":           algo,
            "objective":      round(obj, 4),
            "runtime_s":      runtime,
            "ships_scheduled": len(sched),
            "timestamp":      datetime.now().isoformat(timespec="seconds"),
            **meta,
        }
        self._last_optimize_time = datetime.now()

        self._log(
            "OPTIMIZED",
            f"Schedule optimized ({algo}): {len(sched)} ships, "
            f"objective={obj:.4f}, runtime={runtime}s",
        )
        self._update_departure_predictions()
        return self.meta

    def _update_departure_predictions(self):
        """Update predicted_departure for every ship based on current schedule."""
        rate = float(self.opt_config["crane_rate_tpm"])
        eff  = float(self.opt_config["efficiency"])

        for entry in self.schedule:
            sid = entry.get("ship_id")
            if not sid or not entry.get("compatible"):
                continue
            ship  = self.ship_states.get(sid)
            if not ship:
                continue
            rem_t = float(ship.get("remaining_cargo_t", ship.get("weight_tonnes", 0)))
            start_ms = entry.get("service_start_ms", 0)
            proc_min = calc_processing_time_min(rem_t, 1, rate, eff)
            depart   = datetime.fromtimestamp((start_ms + proc_min * 60_000) / 1000)
            ship["predicted_departure"]  = depart.isoformat()
            ship["predicted_completion"] = depart.isoformat()
            entry["predicted_departure"] = depart.isoformat()

    def update_cargo(self, ship_id: str, sim_time_ms: float):
        """Update remaining cargo based on simulation time progress."""
        ship = self.ship_states.get(ship_id)
        if not ship or ship["status"] != "servicing":
            return
        start_ms = ship.get("_service_start_ms", 0)
        if start_ms == 0:
            return
        elapsed_min = max(0.0, (sim_time_ms - start_ms) / 60_000)
        rate        = float(self.opt_config["crane_rate_tpm"])
        eff         = float(self.opt_config["efficiency"])
        processed   = min(ship["original_cargo_t"], elapsed_min * rate * eff)
        ship["processed_cargo_t"]  = round(processed, 2)
        ship["remaining_cargo_t"]  = round(max(0, ship["original_cargo_t"] - processed), 2)
        proc_left   = calc_processing_time_min(ship["remaining_cargo_t"], 1, rate, eff)
        now_dt      = datetime.fromtimestamp(sim_time_ms / 1000)
        ship["predicted_departure"] = (now_dt + timedelta(minutes=proc_left)).isoformat()

    def on_ship_arrival(self, ship_id: str):
        ship = self.ship_states.get(ship_id)
        if not ship:
            return
        old_status = ship["status"]
        ship["status"] = "waiting"
        self._log("ARRIVAL", f"Ship {ship_id} arrived at port", ship_id=ship_id,
                  old_value=old_status, new_value="waiting")
        if self.opt_config.get("rolling"):
            self._log("TRIGGER", f"Re-optimizing due to arrival of {ship_id}", ship_id=ship_id)
            self.optimize()

    def on_berth_free(self, berth_id: str):
        bs = self.berth_states.get(berth_id)
        if not bs:
            return
        old_ship = bs.get("current_ship")
        bs["current_ship"] = None
        bs["available"]    = True
        bs["occupancy_start"] = None
        self._log("BERTH_FREE", f"Berth {berth_id} is now available", berth_id=berth_id,
                  old_value=old_ship, new_value=None)
        if self.opt_config.get("rolling"):
            self.optimize()

    def on_emergency_halt(self, ship_id: str, halt_hours: float):
        ship = self.ship_states.get(ship_id)
        if not ship:
            return
        ship["halted"]       = True
        ship["halt_hours"]   = float(ship.get("halt_hours", 0)) + halt_hours
        ship["status"]       = "halted"
        self._log("HALT", f"Emergency halt: {ship_id} +{halt_hours}h", ship_id=ship_id,
                  old_value="active", new_value=f"halted +{halt_hours}h")
        if self.opt_config.get("rolling"):
            self.optimize()

    def on_halt_cleared(self, ship_id: str):
        ship = self.ship_states.get(ship_id)
        if not ship:
            return
        ship["halted"] = False
        ship["status"] = "approaching"
        self._log("HALT_CLEARED", f"Halt cleared for {ship_id}", ship_id=ship_id)
        if self.opt_config.get("rolling"):
            self.optimize()

    def get_live_state(self) -> Dict[str, Any]:
        return {
            "ships":     list(self.ship_states.values()),
            "berths":    list(self.berth_states.values()),
            "cranes":    list(self.crane_states.values()),
            "schedule":  self.schedule,
            "event_log": self.event_log[-50:],   # last 50 events
            "meta":      self.meta,
        }

    def compare_all_algorithms(
        self,
        ships: List[Dict],
        berths_list: List[Dict],
        crane_count: int,
    ) -> Dict[str, Any]:
        """Run all algorithms on the same scenario and return comparison."""
        rate   = float(self.opt_config["crane_rate_tpm"])
        eff    = float(self.opt_config["efficiency"])
        switch = float(self.opt_config["switch_cost"])
        aging  = float(self.opt_config["aging_rate"])
        w      = ObjectiveWeights()

        results: Dict[str, Any] = {}
        algos = {
            "FCFS":   schedule_fcfs,
            "SJF":    schedule_sjf,
            "SRPT":   schedule_srpt,
            "Greedy": schedule_greedy,
        }

        for name, fn in algos.items():
            t0   = time.time()
            sched = fn(ships, berths_list, crane_count, rate, eff, switch, aging)
            obj   = compute_objective(sched, w)
            allocated = [e for e in sched if e.get("compatible")]
            results[name] = {
                "objective":        round(obj, 4),
                "avg_wait_min":     round(sum(e["wait_min"] for e in allocated) / max(len(allocated), 1), 2),
                "max_wait_min":     round(max((e["wait_min"] for e in allocated), default=0), 2),
                "avg_flow_min":     round(sum(e["wait_min"] + e["processing_time_min"] for e in allocated) / max(len(allocated), 1), 2),
                "crane_idle_min":   round(sum(e["crane_idle_min"] for e in allocated), 2),
                "berth_util_pct":   round(len(allocated) / max(len(ships), 1) * 100, 1),
                "throughput":       len(allocated),
                "runtime_ms":       round((time.time() - t0) * 1000, 2),
            }

        # QAOA
        t0   = time.time()
        qaoa_sched, qaoa_meta = schedule_qaoa(ships, berths_list, crane_count, rate, eff, switch, w)
        qaoa_obj  = compute_objective(qaoa_sched, w)
        q_alloc   = [e for e in qaoa_sched if e.get("compatible")]
        results["QAOA"] = {
            "objective":      round(qaoa_obj, 4),
            "avg_wait_min":   round(sum(e["wait_min"] for e in q_alloc) / max(len(q_alloc), 1), 2),
            "max_wait_min":   round(max((e["wait_min"] for e in q_alloc), default=0), 2),
            "avg_flow_min":   round(sum(e["wait_min"] + e["processing_time_min"] for e in q_alloc) / max(len(q_alloc), 1), 2),
            "crane_idle_min": round(sum(e["crane_idle_min"] for e in q_alloc), 2),
            "berth_util_pct": round(len(q_alloc) / max(len(ships), 1) * 100, 1),
            "throughput":     len(q_alloc),
            "runtime_ms":     round((time.time() - t0) * 1000, 2),
            "mode":           qaoa_meta.get("mode", "—"),
        }

        return results


# Global engine instance (one per server process)
engine = RollingHorizonEngine()
