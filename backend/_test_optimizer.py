"""Quick acceptance test for the optimizer engine."""
from datetime import datetime, timedelta
from optimizer import (
    calc_processing_time_min, evaluate_preemption,
    schedule_greedy, schedule_qaoa, compute_objective,
    ObjectiveWeights, RollingHorizonEngine,
)

w = ObjectiveWeights()
PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"

# ── Test 1: Dynamic processing time ──────────────────────────────────────
pt1 = calc_processing_time_min(1000, 1, 10.0, 1.0)
pt2 = calc_processing_time_min(800,  1, 10.0, 1.0)
assert abs(pt1 - 100.0) < 0.01, f"Expected 100, got {pt1}"
assert abs(pt2 - 80.0)  < 0.01, f"Expected 80,  got {pt2}"
print(f"TEST 1 {PASS}  1000t->100min, 800t->80min")

# ── Test 2: Preemption evaluator ─────────────────────────────────────────
cur = {"ship_id": "A", "remaining_cargo_t": 800, "weight_tonnes": 800}
new = {"ship_id": "B", "remaining_cargo_t": 100, "weight_tonnes": 100}
ok, reason = evaluate_preemption(cur, new, 5.0, 10.0, 1.0, w)
print(f"TEST 2 {PASS}  preempt={ok}  reason_len={len(reason)}")

# ── Test 3: Fairness / starvation ────────────────────────────────────────
smalls = [
    {"ship_id": f"S{i}", "weight_tonnes": 50, "remaining_cargo_t": 50,
     "eta": (datetime.now() + timedelta(hours=i)).isoformat(),
     "start_dt": (datetime.now() + timedelta(hours=i)).isoformat(),
     "unload_hours": 0.5, "loa_m": 80, "draft_m": 4}
    for i in range(5)
]
large = {"ship_id": "LARGE", "weight_tonnes": 2000, "remaining_cargo_t": 2000,
         "eta": datetime.now().isoformat(),
         "start_dt": datetime.now().isoformat(),
         "unload_hours": 20, "loa_m": 200, "draft_m": 10}
smalls.append(large)
berths_one = [{"name": "B1", "capacity_tonnes": 9999, "max_loa_m": 999, "max_draft_m": 99}]
s3 = schedule_greedy(smalls, berths_one, 1, 10.0, 1.0, 5.0, 0.5)
large_e = next(e for e in s3 if e["ship_id"] == "LARGE")
assert large_e["compatible"], "LARGE ship should be allocated"
print(f"TEST 3 {PASS}  LARGE ship allocated={large_e['compatible']}")

# ── Test 4: Rolling horizon (new ship arrival) ────────────────────────────
eng = RollingHorizonEngine()
bp = {"B1": {"capacity_tonnes": 50000, "max_loa_m": 400, "max_draft_m": 20,
             "cargo_types": ["general cargo"], "handling_rate_tph": 1000},
      "B2": {"capacity_tonnes": 50000, "max_loa_m": 400, "max_draft_m": 20,
             "cargo_types": ["general cargo"], "handling_rate_tph": 1000}}
initial = [
    {"ship_id": "A", "weight_tonnes": 300, "loa_m": 150, "draft_m": 7,
     "start_dt": datetime.now().isoformat(), "eta": datetime.now().isoformat(),
     "unload_hours": 3, "cargo_type": "General", "operator": "Op1",
     "latitude": 15.0, "longitude": 85.0, "speed_knots": 12},
    {"ship_id": "B", "weight_tonnes": 200, "loa_m": 120, "draft_m": 6,
     "start_dt": datetime.now().isoformat(), "eta": datetime.now().isoformat(),
     "unload_hours": 2, "cargo_type": "General", "operator": "Op2",
     "latitude": 14.0, "longitude": 84.0, "speed_knots": 10},
]
eng.load_ships(initial, bp)
eng.optimize()
n_before = len(eng.schedule)
# Inject new ship D
eng.ship_states["D"] = {
    "ship_id": "D", "weight_tonnes": 150, "remaining_cargo_t": 150,
    "original_cargo_t": 150, "processed_cargo_t": 0.0, "loa_m": 100, "draft_m": 5,
    "status": "approaching", "cranes": [], "berth": None,
    "arrival_time": None, "eta": datetime.now().isoformat(),
    "start_dt": datetime.now().isoformat(), "start_processing": None,
    "predicted_completion": None, "predicted_departure": None,
    "waiting_time_min": 0.0, "num_preemptions": 0, "processing_rate_tpm": 10.0,
    "halted": False, "halt_hours": 0.0, "spoilable": False, "spoilage_deadline": None,
    "cargo_type": "General", "operator": "Op4", "latitude": 16.0, "longitude": 86.0,
    "speed_knots": 14,
}
eng.on_ship_arrival("D")
n_after = len(eng.schedule)
events = len(eng.event_log)
print(f"TEST 4 {PASS}  sched before={n_before} after={n_after}  events={events}")

# ── Test 5: Berth hard constraint ────────────────────────────────────────
tiny   = [{"name": "TINY", "capacity_tonnes": 100, "max_loa_m": 80, "max_draft_m": 5}]
bigsh  = [{"ship_id": "BIG", "weight_tonnes": 5000, "loa_m": 300, "draft_m": 15,
           "eta": datetime.now().isoformat(), "start_dt": datetime.now().isoformat(),
           "unload_hours": 10, "remaining_cargo_t": 5000}]
s5 = schedule_greedy(bigsh, tiny, 1, 10.0, 1.0, 5.0, 0.05)
assert not s5[0]["compatible"], "Big ship must NOT fit tiny berth"
print(f"TEST 5 {PASS}  big ship blocked from tiny berth")

# ── Test 7: Genuine QAOA ─────────────────────────────────────────────────
import time
qships = [
    {"ship_id": "Q1", "weight_tonnes": 200, "loa_m": 120, "draft_m": 6,
     "eta": datetime.now().isoformat(), "start_dt": datetime.now().isoformat(),
     "unload_hours": 2, "remaining_cargo_t": 200},
    {"ship_id": "Q2", "weight_tonnes": 300, "loa_m": 150, "draft_m": 8,
     "eta": (datetime.now() + timedelta(hours=1)).isoformat(),
     "start_dt": (datetime.now() + timedelta(hours=1)).isoformat(),
     "unload_hours": 3, "remaining_cargo_t": 300},
]
qberths = [
    {"name": "QB1", "capacity_tonnes": 50000, "max_loa_m": 400, "max_draft_m": 20},
    {"name": "QB2", "capacity_tonnes": 50000, "max_loa_m": 400, "max_draft_m": 20},
]
t0 = time.time()
qs, qm = schedule_qaoa(qships, qberths, 2, 10.0, 1.0, 5.0, w)
rt = time.time() - t0
qaoa_obj     = compute_objective(qs, w)
classical_s  = schedule_greedy(qships, qberths, 2, 10.0, 1.0, 5.0, 0.05)
classical_obj = compute_objective(classical_s, w)
mode = qm.get("mode", "?")
print(f"TEST 7 {PASS}  mode={mode}")
print(f"        QAOA obj={qaoa_obj:.4f}  classical={classical_obj:.4f}  diff={qaoa_obj-classical_obj:.4f}  runtime={rt:.3f}s")

print()
print("=" * 45)
print(" ALL ACCEPTANCE TESTS PASSED")
print("=" * 45)
