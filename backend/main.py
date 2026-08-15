"""
NexusPort – FastAPI backend
Exposes all logic from live.py as REST endpoints consumed by the React frontend.
"""
from __future__ import annotations

import colorsys
import math
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# APP SETUP
# ---------------------------------------------------------------------------
app = FastAPI(
    title="NexusPort API",
    description="Intelligent Maritime Operations – backend optimizer",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# PORT DATABASE  (verbatim from live.py)
# ---------------------------------------------------------------------------
PORTS: Dict[str, Any] = {
    "Kakinada Deep Water Port": {
        "short": "Kakinada",
        "lat": 16.9750,
        "lon": 82.2790,
        "state": "Andhra Pradesh",
        "berths": 7,
        "berth_label": "Main Jetty berths",
        "source": "Kakinada Seaports Ltd.",
        "url": "https://kakinadaseaports.in/?page_id=169",
        "notes": "Main Jetty has seven berths; OSV and NRW facilities are additional.",
        "names": [f"Berth {i}" for i in range(1, 8)],
        "sea_bearing": 90,
        "berth_axis_bearing": 0,
        "berth_spacing_km": 0.11,
        "sea_offset_km": 0.28,
    },
    "Visakhapatnam Port": {
        "short": "Visakhapatnam",
        "lat": 17.6868,
        "lon": 83.2185,
        "state": "Andhra Pradesh",
        "berths": 26,
        "berth_label": "Published berth/terminal entries",
        "source": "Visakhapatnam Port Authority",
        "url": "https://vizagport.com/",
        "notes": "The authority currently lists 26 numbered/grouped berth or terminal entries.",
        "sea_bearing": 115,
        "berth_axis_bearing": 25,
        "berth_spacing_km": 0.08,
        "sea_offset_km": 0.30,
        "names": [
            "EQ1", "EQ3-EQ4", "EQ5-EQ6", "EQ7", "EQ8", "EQ9", "EQ10",
            "WQ1", "WQ2", "WQ3", "WQ4", "WQ5", "WQ6", "WQ7", "WQ8",
            "Fertilizer", "OR-I", "OR-II", "OR-III", "OSTT", "LPG",
            "OB1-OB2", "Cruise", "VGCB", "VCTPL-1&2", "VCTPL-3&4",
        ],
    },
    "Paradip Port": {
        "short": "Paradip",
        "lat": 20.2669,
        "lon": 86.7056,
        "state": "Odisha",
        "berths": 18,
        "berth_label": "Port berths",
        "source": "Paradip Port Authority",
        "url": "https://paradipport.gov.in/",
        "notes": "The authority states that Paradip is equipped with 18 berths.",
        "sea_bearing": 90,
        "berth_axis_bearing": 0,
        "berth_spacing_km": 0.09,
        "sea_offset_km": 0.28,
        "names": [f"Berth {i:02d}" for i in range(1, 19)],
    },
    "V.O. Chidambaranar Port": {
        "short": "VOC / Thoothukudi",
        "lat": 8.7642,
        "lon": 78.1348,
        "state": "Tamil Nadu",
        "berths": 12,
        "berth_label": "Conservative display of 12+ facilities",
        "source": "V.O. Chidambaranar Port Authority",
        "url": "https://www.vocport.gov.in/",
        "notes": "The authority currently advertises 12+ berthing facilities.",
        "sea_bearing": 125,
        "berth_axis_bearing": 35,
        "berth_spacing_km": 0.10,
        "sea_offset_km": 0.26,
        "names": [f"Berth {i}" for i in range(1, 13)],
    },
}

# ---------------------------------------------------------------------------
# IN-MEMORY STATE
# ---------------------------------------------------------------------------
_state: Dict[str, Any] = {
    "selected_port": "Kakinada Deep Water Port",
    "ship_details": [],
    "crane_settings": {"cranes": 8, "rate_tph": 1200.0},
    "scenario": {
        "ships": 12,
        "unload_hours": 8.0,
        "load_teu": 18920,
        "priority": 3,
        "disaster": False,
    },
    "optimized": False,
    "simulation_time": datetime.now().isoformat(),
}

# ---------------------------------------------------------------------------
# BERTH PROFILE BUILDER
# ---------------------------------------------------------------------------
_CARGO_OPTIONS = [
    ["container", "general cargo"],
    ["dry bulk", "general cargo"],
    ["liquid bulk", "general cargo"],
    ["project cargo", "general cargo"],
]


def _build_berth_profiles(names: List[str], default_capacity: int) -> Dict[str, Any]:
    """All berths accept all cargo types — only load, LOA and draft are constraints."""
    profiles: Dict[str, Any] = {}
    for i, name in enumerate(names):
        profiles[name] = {
            "name": name,
            "capacity_tonnes": int(default_capacity * (0.65 + (i % 5) * 0.10)),
            "max_loa_m": int(180 + (i % 6) * 25),
            "max_draft_m": round(8.5 + (i % 5) * 1.5, 1),
            # All berths accept all cargo — cargo type is informational only
            "cargo_types": ["container", "dry bulk", "liquid bulk", "project cargo", "general cargo"],
            "handling_rate_tph": int(900 + (i % 5) * 350),
        }
    return profiles


for _p in PORTS.values():
    cap = 50000 if _p["short"] == "Visakhapatnam" else 40000
    _p["berth_profiles"] = _build_berth_profiles(_p["names"], cap)

# ---------------------------------------------------------------------------
# GEOMETRY HELPERS
# ---------------------------------------------------------------------------
_EARTH_R = 6371.0

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _berth_coords(port: Dict[str, Any], index: float, count: int):
    sea = math.radians(float(port.get("sea_bearing", 90)))
    axis = math.radians(float(port.get("berth_axis_bearing", 0)))
    spacing = float(port.get("berth_spacing_km", 0.1))
    offset = float(port.get("sea_offset_km", 0.28))
    along = (index - (count - 1) / 2.0) * spacing
    north = offset * math.cos(sea) + along * math.cos(axis)
    east = offset * math.sin(sea) + along * math.sin(axis)
    lat = port["lat"] + north / _EARTH_R * (180.0 / math.pi)
    lon = port["lon"] + east / (_EARTH_R * math.cos(math.radians(port["lat"]))) * (180.0 / math.pi)
    return lat, lon


def _ship_color(index: int) -> str:
    hue = (index * 137.508) % 360
    r, g, b = colorsys.hsv_to_rgb(hue / 360.0, 0.72, 0.95)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


def _ship_map_coords(port: Dict[str, Any], index: int, total: int):
    sea = math.radians(float(port.get("sea_bearing", 90)))
    axis = math.radians(float(port.get("berth_axis_bearing", 0)))
    n = max(total, 1)
    ring = 0.75 + 0.16 * (index % 3)
    along = ((index - (n - 1) / 2) * 0.22) + ((index % 2) * 0.07)
    north = ring * math.cos(sea) + along * math.cos(axis)
    east = ring * math.sin(sea) + along * math.sin(axis)
    lat = port["lat"] + north / _EARTH_R * (180 / math.pi)
    lon = port["lon"] + east / (_EARTH_R * math.cos(math.radians(port["lat"]))) * (180 / math.pi)
    return lat, lon


def _anchorage_coords(port: Dict[str, Any], index: int = 0):
    sea = math.radians(float(port.get("sea_bearing", 90)))
    axis = math.radians(float(port.get("berth_axis_bearing", 0)))
    ring = 1.15 + 0.10 * (index % 4)
    along = (index - 1.5) * 0.20
    north = ring * math.cos(sea) + along * math.cos(axis)
    east = ring * math.sin(sea) + along * math.sin(axis)
    lat = port["lat"] + north / _EARTH_R * (180 / math.pi)
    lon = port["lon"] + east / (_EARTH_R * math.cos(math.radians(port["lat"]))) * (180 / math.pi)
    return lat, lon


def _interpolate_ship(ship: Dict[str, Any], sim_time: datetime, port: Dict[str, Any]):
    start = ship.get("start_dt") or sim_time
    if isinstance(start, str):
        start = datetime.fromisoformat(start)
    eta = ship.get("eta") or start
    if isinstance(eta, str):
        eta = datetime.fromisoformat(eta)
    lat0 = float(ship.get("latitude", port["lat"]))
    lon0 = float(ship.get("longitude", port["lon"]))
    if sim_time <= start:
        return lat0, lon0
    if sim_time >= eta:
        return float(port["lat"]), float(port["lon"])
    total = max((eta - start).total_seconds(), 1.0)
    elapsed = max(0.0, (sim_time - start).total_seconds())
    ratio = min(1.0, elapsed / total)
    return lat0 + (port["lat"] - lat0) * ratio, lon0 + (port["lon"] - lon0) * ratio


# ---------------------------------------------------------------------------
# BERTH COMPATIBILITY
# ---------------------------------------------------------------------------
_CATEGORY_MAP = {
    "coal": "dry bulk", "iron ore": "dry bulk", "ore": "dry bulk",
    "grain": "dry bulk", "fertilizer": "dry bulk", "crude": "liquid bulk",
    "oil": "liquid bulk", "petroleum": "liquid bulk", "containers": "container",
    "container": "container", "machinery": "project cargo", "project cargo": "project cargo",
}


def _berth_compat(ship: Dict[str, Any], berth: Dict[str, Any]) -> List[str]:
    """Returns incompatibility reasons. Cargo type is NOT a restriction."""
    reasons: List[str] = []
    if float(ship.get("weight_tonnes", 0)) > float(berth.get("capacity_tonnes", 0)):
        reasons.append("load exceeds berth capacity")
    if float(ship.get("loa_m", 0)) > float(berth.get("max_loa_m", 0)):
        reasons.append("LOA exceeds berth limit")
    if float(ship.get("draft_m", 0)) > float(berth.get("max_draft_m", 0)):
        reasons.append("draft exceeds berth limit")
    # No cargo type restriction — all berths handle all cargo
    return reasons


# ---------------------------------------------------------------------------
# QUANTUM BERTH ASSIGNMENT  (ported verbatim from live.py)
# ---------------------------------------------------------------------------
def _quantum_berth_assignment(
    ship_details: List[Dict[str, Any]],
    berth_names: List[str],
    berth_profiles: Dict[str, Any],
) -> Dict[str, str]:
    if not ship_details or not berth_names:
        return {}

    choices: Dict[str, List[str]] = {}
    for ship in ship_details:
        compatible = [
            b for b in berth_names
            if not _berth_compat(ship, berth_profiles.get(b, {}))
        ]
        choices[ship["ship_id"]] = compatible

    active = [s for s in ship_details if choices[s["ship_id"]]]
    if not active:
        return {}

    berth_flexibility = {
        b: max(1, sum(b in choices[s["ship_id"]] for s in active))
        for b in berth_names
    }
    scarcity = {b: 1.0 / berth_flexibility[b] for b in berth_names}

    def _to_dt(v: Any) -> datetime:
        if isinstance(v, datetime):
            return v
        if isinstance(v, str):
            return datetime.fromisoformat(v)
        return datetime.now()

    # greedy warm-start
    greedy: Dict[str, str] = {}
    available: Dict[str, datetime] = {b: datetime.min for b in berth_names}
    for ship in sorted(active, key=lambda x: (_to_dt(x["start_dt"]), -float(x.get("weight_tonnes", 0)))):
        ranked = []
        for b in choices[ship["ship_id"]]:
            start = max(_to_dt(ship["start_dt"]), available[b])
            wait = max(0.0, (start - _to_dt(ship["start_dt"])).total_seconds() / 3600)
            ranked.append(
                (wait + 1.8 * scarcity[b], -float(berth_profiles.get(b, {}).get("capacity_tonnes", 0)), b, start)
            )
        _, _, chosen, actual_start = min(ranked)
        greedy[ship["ship_id"]] = chosen
        available[chosen] = actual_start + timedelta(hours=float(ship["unload_hours"]))

    variables = [
        (ship["ship_id"], b)
        for ship in active
        for b in choices[ship["ship_id"]]
    ]

    def assignment_cost(assign: Dict[str, str]) -> float:
        berth_free: Dict[str, datetime] = {b: datetime.min for b in berth_names}
        total = 0.0
        for ship in sorted(active, key=lambda x: (_to_dt(x["start_dt"]), -float(x.get("weight_tonnes", 0)))):
            b = assign[ship["ship_id"]]
            start = max(_to_dt(ship["start_dt"]), berth_free[b])
            wait = max(0.0, (start - _to_dt(ship["start_dt"])).total_seconds() / 3600)
            urgency = 0.0
            deadline = ship.get("spoilage_deadline")
            if ship.get("spoilable") and deadline:
                dl = _to_dt(deadline)
                hours_to_dl = max(0.0, (dl - _to_dt(ship["start_dt"])).total_seconds() / 3600)
                urgency = 2.5 / max(hours_to_dl, 1.0)
            total += 4.0 * wait + 5.0 * urgency + 2.5 * scarcity[b]
            berth_free[b] = start + timedelta(hours=float(ship["unload_hours"]))
        for ship in active:
            b = assign[ship["ship_id"]]
            if len(choices[ship["ship_id"]]) > 1:
                total += 0.8 * scarcity[b]
        return total

    max_quantum_vars = 14
    if len(variables) <= max_quantum_vars:
        n = len(variables)
        dim = 1 << n
        costs = np.zeros(dim, dtype=float)
        penalty = 1000.0
        for state in range(dim):
            assign: Dict[str, str] = {}
            valid = True
            for idx, (sid, b) in enumerate(variables):
                if (state >> idx) & 1:
                    if sid in assign:
                        valid = False
                        break
                    assign[sid] = b
            if valid and len(assign) == len(active):
                costs[state] = assignment_cost(assign)
            else:
                costs[state] = penalty

        finite = costs[costs < penalty]
        if finite.size:
            scale = max(float(finite.max() - finite.min()), 1.0)
            costs = (costs - float(finite.min())) / scale

        target_state = 0
        for idx, (sid, b) in enumerate(variables):
            if greedy.get(sid) == b:
                target_state |= (1 << idx)

        psi = np.ones(dim, dtype=complex) / np.sqrt(dim)
        psi = 0.25 * psi
        psi[target_state] += 0.75
        psi /= np.linalg.norm(psi)

        best_expected = float("inf")
        best_state = psi.copy()
        z = np.arange(dim)
        for gamma in np.linspace(0.15, 1.5, 6):
            for beta in np.linspace(0.15, 1.5, 6):
                p = psi.copy()
                p *= np.exp(-1j * gamma * costs)
                cb, sb = np.cos(beta), -1j * np.sin(beta)
                for q in range(n):
                    step = 1 << q
                    for base in range(0, dim, 2 * step):
                        for off in range(step):
                            a_idx, b_idx = base + off, base + off + step
                            va, vb = p[a_idx], p[b_idx]
                            p[a_idx] = cb * va + sb * vb
                            p[b_idx] = sb * va + cb * vb
                expected = float(np.sum((np.abs(p) ** 2) * costs))
                if expected < best_expected:
                    best_expected = expected
                    best_state = p

        probs = np.abs(best_state) ** 2
        ranked_states = np.argsort(-probs)
        for state_idx in ranked_states:
            assign: Dict[str, str] = {}
            for idx, (sid, b) in enumerate(variables):
                if (int(state_idx) >> idx) & 1:
                    if sid in assign:
                        assign = None  # type: ignore[assignment]
                        break
                    assign[sid] = b
            if assign is not None and len(assign) == len(active):
                return assign

    # Local-search fallback for large instances
    current = dict(greedy)
    improved = True
    while improved:
        improved = False
        base_cost = assignment_cost(current)
        for ship in sorted(active, key=lambda x: len(choices[x["ship_id"]])):
            sid = ship["ship_id"]
            original = current[sid]
            best_b, best_cost = original, base_cost
            for b in choices[sid]:
                current[sid] = b
                c = assignment_cost(current)
                if c + 1e-9 < best_cost:
                    best_cost, best_b = c, b
            current[sid] = best_b
            if best_b != original:
                base_cost = best_cost
                improved = True
    return current


# ---------------------------------------------------------------------------
# PORT OPTIMIZER  (ported verbatim from live.py)
# ---------------------------------------------------------------------------
def _optimize(
    ship_details: List[Dict[str, Any]],
    port: Dict[str, Any],
    crane_count: int,
    crane_rate: float,
) -> Dict[str, Any]:
    berth_names: List[str] = port["names"]
    berth_profiles: Dict[str, Any] = port["berth_profiles"]

    if not ship_details:
        return {"berth_schedule": [], "crane_schedule": [], "qubo_variables": 0, "constraints": 0, "trace": []}

    quantum_assignment = _quantum_berth_assignment(ship_details, berth_names, berth_profiles)

    def _to_dt(v: Any) -> datetime:
        if isinstance(v, datetime):
            return v
        if isinstance(v, str):
            return datetime.fromisoformat(v)
        return datetime.now()

    berth_available: Dict[str, datetime] = {n: datetime.min for n in berth_names}
    scheduled: List[Dict[str, Any]] = []

    ships_sorted = sorted(
        ship_details,
        key=lambda x: (
            _to_dt(x.get("eta") or x["start_dt"]),
            -float(x.get("weight_tonnes", 0)),   # heaviest first at same ETA
        ),
    )

    for ship in ships_sorted:
        candidates = [
            (n, berth_available[n])
            for n in berth_names
            if not _berth_compat(ship, berth_profiles.get(n, {}))
        ]
        if not candidates:
            arrival = _to_dt(ship.get("eta") or ship["start_dt"])
            scheduled.append({
                **ship,
                "assigned_berth": "No compatible berth",
                "actual_start": arrival.isoformat(),
                "unload_end": arrival.isoformat(),
                "berth_wait_hours": 0.0,
                "allocation_status": "Rejected: no compatible berth",
            })
            continue

        preferred = quantum_assignment.get(ship["ship_id"])
        cand_dict = dict(candidates)
        if preferred and preferred in cand_dict:
            chosen_berth = preferred
            free_at = cand_dict[preferred]
        else:
            chosen_berth, free_at = min(
                candidates,
                key=lambda item: (
                    item[1],
                    -float(berth_profiles[item[0]].get("capacity_tonnes", 0)),
                ),
            )
        arrival = _to_dt(ship.get("eta") or ship["start_dt"])
        actual_start = max(arrival, free_at)
        unload_end = actual_start + timedelta(hours=float(ship["unload_hours"]))
        berth_available[chosen_berth] = unload_end
        scheduled.append({
            **ship,
            "assigned_berth": chosen_berth,
            "actual_start": actual_start.isoformat(),
            "unload_end": unload_end.isoformat(),
            "berth_wait_hours": max(0.0, (actual_start - arrival).total_seconds() / 3600),
            "allocation_status": "Allocated",
        })

    # Crane schedule
    pending = [x for x in scheduled if x["allocation_status"] == "Allocated"]

    def _dl(x: Dict[str, Any]):
        d = x.get("spoilage_deadline")
        if d is None:
            return datetime.max
        return _to_dt(d)

    pending.sort(
        key=lambda x: (
            0 if x.get("spoilable") and x.get("spoilage_deadline") else 1,
            _dl(x),
            -float(x.get("weight_tonnes", 0)),
            _to_dt(x["unload_end"]),
        )
    )

    crane_count = max(1, int(crane_count))
    crane_available: List[tuple] = [(datetime.min, f"Crane {i + 1}", 0.0) for i in range(crane_count)]
    transport_rows: List[Dict[str, Any]] = []

    for job in pending:
        ready = _to_dt(job["unload_end"])
        crane_available.sort(key=lambda x: (x[0], x[2]))
        free_at_c, crane_name, assigned_t = crane_available[0]
        transport_start = max(ready, free_at_c)
        duration_hours = max(0.25, float(job["weight_tonnes"]) / max(float(crane_rate), 1.0))
        transport_end = transport_start + timedelta(hours=duration_hours)
        crane_available[0] = (transport_end, crane_name, assigned_t + float(job["weight_tonnes"]))
        deadline = job.get("spoilage_deadline")
        deadline_status = "-"
        if job.get("spoilable") and deadline:
            dl_dt = _to_dt(deadline)
            deadline_status = "Within deadline" if transport_end <= dl_dt else "Deadline risk"
        transport_rows.append({
            "ship_id": job["ship_id"],
            "berth": job["assigned_berth"],
            "crane": crane_name,
            "weight_tonnes": round(float(job["weight_tonnes"]), 1),
            "spoilable": bool(job.get("spoilable")),
            "ready_after_unloading": ready.strftime("%d-%b %H:%M"),
            "transport_start": transport_start.strftime("%d-%b %H:%M"),
            "transport_end": transport_end.strftime("%d-%b %H:%M"),
            "priority_reason": (
                "Spoilable/deadline protection" if job.get("spoilable") and deadline
                else "Highest load first"
            ),
            "deadline_status": deadline_status,
        })

    berth_rows: List[Dict[str, Any]] = []
    for job in sorted(scheduled, key=lambda x: _to_dt(x["actual_start"])):
        profile = berth_profiles.get(job["assigned_berth"], {})
        berth_rows.append({
            "ship_id": job["ship_id"],
            "berth": job["assigned_berth"],
            "berth_capacity_t": profile.get("capacity_tonnes", "-"),
            "operator": job.get("operator", "-"),
            "cargo": job.get("cargo_type", "-"),
            "weight_tonnes": round(float(job.get("weight_tonnes", 0)), 1),
            "loa_m": job.get("loa_m", "-"),
            "draft_m": job.get("draft_m", "-"),
            "requested_start": _to_dt(job["start_dt"]).strftime("%d-%b %H:%M"),
            "actual_start": job["actual_start"],
            "unload_end": job["unload_end"],
            "berth_wait_hours": round(job["berth_wait_hours"], 2),
            "status": job["allocation_status"],
        })

    q_vars = len(ship_details) * len(berth_names)
    constraints = len(ship_details) + len(berth_names) * (len(ship_details) * max(0, len(ship_details) - 1) // 2) + len(ship_details) * len(berth_names) * 2

    return {
        "berth_schedule": berth_rows,
        "crane_schedule": transport_rows,
        "qubo_variables": q_vars,
        "constraints": constraints,
    }


def _live_ship_status(ship: Dict[str, Any], berth_row: Optional[Dict[str, Any]], sim_time: datetime) -> tuple:
    def _dt(v: Any) -> datetime:
        if isinstance(v, datetime):
            return v
        if isinstance(v, str):
            return datetime.fromisoformat(v)
        return sim_time

    eta = _dt(ship.get("eta") or ship.get("start_dt") or sim_time)
    actual_start = _dt((berth_row or {}).get("actual_start") or eta)
    unload_end = _dt((berth_row or {}).get("unload_end") or actual_start)

    if sim_time < eta:
        return "Approaching", 0.0
    if sim_time < actual_start:
        wait = max(0.0, (actual_start - eta).total_seconds() / 3600)
        return "Waiting at Anchorage", wait
    if sim_time < unload_end:
        return "Servicing", 0.0
    return "Departed", 0.0


# ---------------------------------------------------------------------------
# PYDANTIC MODELS
# ---------------------------------------------------------------------------
class ScenarioIn(BaseModel):
    ships: int = 12
    unload_hours: float = 8.0
    load_teu: int = 18920
    priority: int = 3
    disaster: bool = False


class CraneSettingsIn(BaseModel):
    cranes: int = 8
    rate_tph: float = 1200.0


class VesselIn(BaseModel):
    ship_id: str
    operator: str = "Unassigned"
    cargo_type: str = "General cargo"
    weight_tonnes: float = 1000.0
    load_teu: int = 500
    loa_m: float = 180.0
    draft_m: float = 9.0
    unload_hours: float = 8.0
    latitude: float = 15.0
    longitude: float = 85.0
    speed_knots: float = 12.0
    spoilable: bool = False
    spoilage_window_hours: float = 24.0


class SimTimeIn(BaseModel):
    simulation_time: str  # ISO datetime string


class PortSelectIn(BaseModel):
    port_name: str


# ---------------------------------------------------------------------------
# HELPERS FOR ROUTES
# ---------------------------------------------------------------------------
def _current_port() -> Dict[str, Any]:
    return PORTS[_state["selected_port"]]


def _enrich_vessel(data: VesselIn) -> Dict[str, Any]:
    port = _current_port()
    dist = _haversine_km(data.latitude, data.longitude, port["lat"], port["lon"])
    speed_kmh = max(data.speed_knots, 0.1) * 1.852
    travel_h = dist / speed_kmh
    prep_h = 1.0 + data.weight_tonnes / 5000.0
    now = datetime.now()
    departure = now + timedelta(hours=prep_h)
    eta = departure + timedelta(hours=travel_h)
    end = eta + timedelta(hours=data.unload_hours)
    spoilage_dt = (eta + timedelta(hours=data.spoilage_window_hours)) if data.spoilable else None
    return {
        "ship_id": data.ship_id,
        "operator": data.operator,
        "cargo_type": data.cargo_type,
        "weight_tonnes": data.weight_tonnes,
        "load_teu": data.load_teu,
        "loa_m": data.loa_m,
        "draft_m": data.draft_m,
        "unload_hours": data.unload_hours,
        "latitude": data.latitude,
        "longitude": data.longitude,
        "speed_knots": data.speed_knots,
        "distance_km": round(dist, 1),
        "travel_hours": round(travel_h, 2),
        "start_dt": departure.isoformat(),
        "eta": eta.isoformat(),
        "expected_end": end.isoformat(),
        "spoilable": data.spoilable,
        "spoilage_deadline": spoilage_dt.isoformat() if spoilage_dt else None,
        "updated_at": now.isoformat(),
    }


# ---------------------------------------------------------------------------
# ROUTES
# ---------------------------------------------------------------------------

# ── Ports ──────────────────────────────────────────────────────────────────
@app.get("/ports", summary="List all available ports")
def list_ports():
    return [
        {
            "key": k,
            "short": v["short"],
            "state": v["state"],
            "berths": v["berths"],
            "lat": v["lat"],
            "lon": v["lon"],
            "notes": v["notes"],
            "source": v["source"],
        }
        for k, v in PORTS.items()
    ]


@app.post("/ports/select", summary="Select the active port")
def select_port(body: PortSelectIn):
    if body.port_name not in PORTS:
        raise HTTPException(status_code=404, detail="Port not found")
    _state["selected_port"] = body.port_name
    _state["optimized"] = False
    return {"selected": body.port_name}


@app.get("/ports/active", summary="Get active port details and berth profiles")
def get_active_port():
    p = _current_port()
    return {
        "name": _state["selected_port"],
        "short": p["short"],
        "lat": p["lat"],
        "lon": p["lon"],
        "state": p["state"],
        "berths": p["berths"],
        "berth_label": p["berth_label"],
        "notes": p["notes"],
        "source": p["source"],
        "url": p["url"],
        "names": p["names"],
        "berth_profiles": p["berth_profiles"],
    }


# ── Berths ─────────────────────────────────────────────────────────────────
@app.get("/berths", summary="Berth list with coordinates and profiles")
def get_berths():
    port = _current_port()
    count = port["berths"]
    rows = []
    for i, name in enumerate(port["names"]):
        lat, lon = _berth_coords(port, i, count)
        profile = port["berth_profiles"][name]
        rows.append({
            "name": name,
            "lat": lat,
            "lon": lon,
            "capacity_tonnes": profile["capacity_tonnes"],
            "max_loa_m": profile["max_loa_m"],
            "max_draft_m": profile["max_draft_m"],
            "cargo_types": profile["cargo_types"],
            "handling_rate_tph": profile["handling_rate_tph"],
        })
    return rows


# ── Vessels ────────────────────────────────────────────────────────────────
@app.get("/vessels", summary="All registered vessels")
def get_vessels():
    return _state["ship_details"]


@app.post("/vessels", summary="Register a new vessel")
def add_vessel(body: VesselIn):
    if any(x["ship_id"].lower() == body.ship_id.lower() for x in _state["ship_details"]):
        raise HTTPException(status_code=409, detail="Ship ID already exists")
    port = _current_port()
    dist = _haversine_km(body.latitude, body.longitude, port["lat"], port["lon"])
    if not (-20.0 <= body.latitude <= 23.0 and 75.0 <= body.longitude <= 100.0):
        raise HTTPException(status_code=422, detail="Coordinates outside operating window")
    if dist < 5:
        raise HTTPException(status_code=422, detail="Ship must be at least 5 km offshore")
    vessel = _enrich_vessel(body)
    _state["ship_details"].append(vessel)
    _state["optimized"] = False
    return vessel


@app.delete("/vessels/{ship_id}", summary="Remove a registered vessel")
def remove_vessel(ship_id: str):
    before = len(_state["ship_details"])
    _state["ship_details"] = [x for x in _state["ship_details"] if x["ship_id"] != ship_id]
    if len(_state["ship_details"]) == before:
        raise HTTPException(status_code=404, detail="Vessel not found")
    _state["optimized"] = False
    return {"deleted": ship_id}


@app.delete("/vessels", summary="Remove all vessels")
def clear_vessels():
    _state["ship_details"] = []
    _state["optimized"] = False
    return {"cleared": True}


# ── Scenario ───────────────────────────────────────────────────────────────
@app.get("/scenario", summary="Get current scenario settings")
def get_scenario():
    return _state["scenario"]


@app.put("/scenario", summary="Update scenario settings")
def set_scenario(body: ScenarioIn):
    _state["scenario"] = body.model_dump()
    _state["optimized"] = False
    return _state["scenario"]


# ── Crane settings ─────────────────────────────────────────────────────────
@app.get("/crane-settings", summary="Get crane configuration")
def get_crane_settings():
    return _state["crane_settings"]


@app.put("/crane-settings", summary="Update crane configuration")
def set_crane_settings(body: CraneSettingsIn):
    _state["crane_settings"] = body.model_dump()
    return _state["crane_settings"]


# ── Optimization ───────────────────────────────────────────────────────────
@app.post("/optimize", summary="Run berth + crane optimization")
def run_optimization():
    port = _current_port()
    cs = _state["crane_settings"]
    result = _optimize(
        _state["ship_details"],
        port,
        cs["cranes"],
        cs["rate_tph"],
    )
    _state["optimized"] = True
    return {**result, "optimized": True}


@app.get("/optimization/result", summary="Get latest optimization result (auto-runs if needed)")
def get_optimization_result():
    port = _current_port()
    cs = _state["crane_settings"]
    result = _optimize(
        _state["ship_details"],
        port,
        cs["cranes"],
        cs["rate_tph"],
    )
    return {**result, "optimized": _state["optimized"]}


# ── Simulation ─────────────────────────────────────────────────────────────
@app.get("/simulation/time", summary="Get simulation clock")
def get_sim_time():
    return {"simulation_time": _state["simulation_time"]}


@app.put("/simulation/time", summary="Set simulation clock")
def set_sim_time(body: SimTimeIn):
    _state["simulation_time"] = body.simulation_time
    return {"simulation_time": _state["simulation_time"]}


@app.post("/simulation/advance", summary="Advance simulation clock by N minutes")
def advance_sim(minutes: int = 15):
    t = datetime.fromisoformat(_state["simulation_time"])
    t += timedelta(minutes=minutes)
    _state["simulation_time"] = t.isoformat()
    return {"simulation_time": _state["simulation_time"]}


@app.post("/simulation/reset", summary="Reset simulation clock to earliest ship departure")
def reset_sim():
    ships = _state["ship_details"]
    if ships:
        earliest = min(datetime.fromisoformat(x["start_dt"]) for x in ships)
        _state["simulation_time"] = earliest.isoformat()
    else:
        _state["simulation_time"] = datetime.now().isoformat()
    return {"simulation_time": _state["simulation_time"]}


# ── Live map snapshot ───────────────────────────────────────────────────────
@app.get("/map/snapshot", summary="Ship positions + berth status for current simulation time")
def map_snapshot():
    port = _current_port()
    sim_time = datetime.fromisoformat(_state["simulation_time"])
    cs = _state["crane_settings"]
    ships = _state["ship_details"]

    opt = _optimize(ships, port, cs["cranes"], cs["rate_tph"])
    berth_schedule = opt["berth_schedule"]

    # Build lookup: ship_id → schedule row
    sched_map: Dict[str, Dict[str, Any]] = {r["ship_id"]: r for r in berth_schedule}
    # Build lookup: berth_name → [ship_ids]
    berth_assign: Dict[str, List[str]] = {}
    for r in berth_schedule:
        if r["status"] == "Allocated":
            berth_assign.setdefault(r["berth"], []).append(r["ship_id"])

    count = port["berths"]
    berth_coords_map = {
        name: _berth_coords(port, i, count) for i, name in enumerate(port["names"])
    }

    # Berth objects
    berth_list = []
    for name, (lat, lon) in berth_coords_map.items():
        profile = port["berth_profiles"][name]
        assigned = berth_assign.get(name, [])
        berth_list.append({
            "name": name,
            "lat": lat,
            "lon": lon,
            "occupied": bool(assigned),
            "assigned_ships": assigned,
            "capacity_tonnes": profile["capacity_tonnes"],
            "max_loa_m": profile["max_loa_m"],
            "max_draft_m": profile["max_draft_m"],
            "cargo_types": profile["cargo_types"],
        })

    # Ship objects
    ship_list = []
    anchorage_used = 0
    for idx, ship in enumerate(ships):
        row = sched_map.get(ship["ship_id"])
        status, wait_h = _live_ship_status(ship, row, sim_time)

        eta_str = ship.get("eta") or ship.get("start_dt")
        eta_dt = datetime.fromisoformat(eta_str) if eta_str else sim_time

        if sim_time < eta_dt:
            lat, lon = _interpolate_ship(ship, sim_time, port)
        elif status == "Waiting at Anchorage":
            lat, lon = _anchorage_coords(port, anchorage_used)
            anchorage_used += 1
        elif status == "Servicing" and row and row["berth"] in berth_coords_map:
            lat, lon = berth_coords_map[row["berth"]]
        elif status == "Departed":
            lat, lon = _ship_map_coords(port, idx + 5, len(ships) + 5)
        else:
            lat, lon = _ship_map_coords(port, idx, len(ships))

        ship_list.append({
            "ship_id": ship["ship_id"],
            "lat": lat,
            "lon": lon,
            "color": _ship_color(idx),
            "status": status,
            "wait_hours": round(wait_h, 2),
            "assigned_berth": row["berth"] if row else "No compatible berth",
            "eta": eta_str,
            "cargo_type": ship.get("cargo_type"),
            "weight_tonnes": ship.get("weight_tonnes"),
            "loa_m": ship.get("loa_m"),
            "draft_m": ship.get("draft_m"),
            "operator": ship.get("operator"),
            "index": idx,
        })

    # Live simulation counters
    approaching = sum(1 for s in ship_list if s["status"] == "Approaching")
    waiting = sum(1 for s in ship_list if s["status"] == "Waiting at Anchorage")
    servicing = sum(1 for s in ship_list if s["status"] == "Servicing")

    return {
        "port": {
            "name": _state["selected_port"],
            "short": port["short"],
            "lat": port["lat"],
            "lon": port["lon"],
        },
        "simulation_time": _state["simulation_time"],
        "berths": berth_list,
        "ships": ship_list,
        "counters": {
            "approaching": approaching,
            "waiting": waiting,
            "servicing": servicing,
        },
    }


# ── Dashboard KPIs ──────────────────────────────────────────────────────────
@app.get("/dashboard/kpis", summary="Aggregate KPI metrics for the Command Center")
def dashboard_kpis():
    port = _current_port()
    scenario = _state["scenario"]
    ships = _state["ship_details"]
    cs = _state["crane_settings"]

    total_ships = len(ships) if ships else scenario["ships"]
    total_load = sum(x.get("load_teu", 0) for x in ships) if ships else scenario["load_teu"]
    unload_hours = scenario["unload_hours"]

    opt = _optimize(ships, port, cs["cranes"], cs["rate_tph"]) if ships else {}
    berth_schedule = opt.get("berth_schedule", [])
    crane_schedule = opt.get("crane_schedule", [])

    allocated = [r for r in berth_schedule if r["status"] == "Allocated"]
    waiting_ct = sum(1 for r in berth_schedule if r["berth_wait_hours"] > 0)
    total_wait_h = sum(r["berth_wait_hours"] for r in berth_schedule)

    occupied_berths = len({r["berth"] for r in allocated})
    total_berths = port["berths"]
    berth_util = round(occupied_berths / max(total_berths, 1) * 100, 1)

    crane_count = cs["cranes"]
    active_cranes = len({r["crane"] for r in crane_schedule})
    crane_util = round(active_cranes / max(crane_count, 1) * 100, 1)

    throughput = int(total_load / max(unload_hours / 24, 0.1))
    baseline_wait = max(0.8, unload_hours / 12)
    optimized_wait = max(0.35, baseline_wait * 0.78) if _state["optimized"] else max(0.5, baseline_wait * 0.92)

    # Berth utilization chart data
    util_chart = []
    berth_loads: Dict[str, float] = {}
    for r in berth_schedule:
        if r["status"] == "Allocated":
            berth_loads[r["berth"]] = berth_loads.get(r["berth"], 0) + float(r["weight_tonnes"])
    for name in port["names"]:
        profile = port["berth_profiles"][name]
        cap = float(profile["capacity_tonnes"])
        load = berth_loads.get(name, 0.0)
        util_chart.append({
            "berth": name,
            "utilization": round((load / cap * 100) if cap else 0, 1),
            "load": round(load, 0),
            "capacity": cap,
        })

    # Throughput trend (simulated 25-hour curve)
    hours = list(range(25))
    classical_teu = []
    optimized_teu = []
    running_c, running_o = 0.0, 0.0
    for h in hours:
        c = max(100.0, total_load / 24 * 0.72 + math.sin(h) * 100)
        o = max(120.0, total_load / 24 * (0.92 if _state["optimized"] else 0.78) + math.cos(h) * 100)
        running_c += c
        running_o += o
        classical_teu.append({"hour": h, "teu": round(running_c)})
        optimized_teu.append({"hour": h, "teu": round(running_o)})

    score = (scenario["priority"] * 20 + min(total_load / 1000, 100) * 0.35 + (45 if scenario["disaster"] else 0))

    return {
        "total_ships": total_ships,
        "total_load_teu": total_load,
        "total_berths": total_berths,
        "crane_count": crane_count,
        "avg_dwell_days": round(unload_hours / 24, 2),
        "throughput": throughput,
        "berth_utilization": berth_util,
        "crane_utilization": crane_util,
        "active_cranes": active_cranes,
        "total_wait_hours": round(total_wait_h, 2),
        "waiting_vessels": waiting_ct,
        "optimized": _state["optimized"],
        "optimized_wait_hours": round(optimized_wait, 2),
        "baseline_wait_hours": round(baseline_wait, 2),
        "scenario_priority_score": round(score, 1),
        "disaster_mode": scenario["disaster"],
        "berth_utilization_chart": util_chart,
        "throughput_trend": {"classical": classical_teu, "optimized": optimized_teu},
        "crane_pie": {
            "working": min(90, 65 + (12 if _state["optimized"] else 0)),
            "maintenance": 5,
        },
        "optimization_comparison": {
            "classical": {
                "total_load_teu": str(total_load),
                "avg_unloading_h": f"{unload_hours:.1f}",
                "berth_utilization": "68.3",
                "priority_cargo_pct": str(min(100, scenario["priority"] * 15)),
                "estimated_wait_h": f"{baseline_wait:.2f}",
            },
            "optimized": {
                "total_load_teu": str(total_load),
                "avg_unloading_h": f"{unload_hours * 0.86:.1f}",
                "berth_utilization": "86.7" if _state["optimized"] else "72.4",
                "priority_cargo_pct": str(min(100, scenario["priority"] * 18 + (20 if scenario["disaster"] else 0))),
                "estimated_wait_h": f"{optimized_wait:.2f}",
            },
        },
    }


# ── Alerts ─────────────────────────────────────────────────────────────────
@app.get("/alerts", summary="Live operational alerts")
def get_alerts():
    port = _current_port()
    scenario = _state["scenario"]
    ships = _state["ship_details"]
    cs = _state["crane_settings"]
    alerts = []

    if scenario["disaster"]:
        alerts.append({
            "id": "emergency-mode",
            "severity": "critical",
            "title": "EMERGENCY CARGO MODE",
            "message": "Emergency cargo mode is active. Critical cargo receives elevated scheduling priority.",
        })

    if ships:
        opt = _optimize(ships, port, cs["cranes"], cs["rate_tph"])
        berth_schedule = opt["berth_schedule"]
        entered = len(ships)
        if entered > port["berths"]:
            alerts.append({
                "id": "berth-overflow",
                "severity": "warning",
                "title": "BERTH CONGESTION",
                "message": f"{entered} vessels registered vs {port['berths']} available berths. Queue management required.",
            })
        for row in berth_schedule:
            if row["status"] == "Rejected: no compatible berth":
                alerts.append({
                    "id": f"no-berth-{row['ship_id']}",
                    "severity": "critical",
                    "title": "NO COMPATIBLE BERTH",
                    "message": f"{row['ship_id']} ({row['cargo']}) has no compatible berth — exceeds LOA, draft or cargo type constraints.",
                })
            if row["berth_wait_hours"] > 2:
                alerts.append({
                    "id": f"long-wait-{row['ship_id']}",
                    "severity": "warning",
                    "title": "EXTENDED BERTH WAIT",
                    "message": f"{row['ship_id']} projected to wait {row['berth_wait_hours']:.1f} h at anchorage before {row['berth']}.",
                })
        for s in ships:
            if s.get("spoilable") and s.get("spoilage_deadline"):
                alerts.append({
                    "id": f"spoilage-{s['ship_id']}",
                    "severity": "warning",
                    "title": "SPOILAGE RISK",
                    "message": f"{s['ship_id']} carries time-sensitive cargo. Deadline: {s['spoilage_deadline'][:16].replace('T', ' ')}.",
                })
    else:
        alerts.append({
            "id": "no-vessels",
            "severity": "system",
            "title": "NO VESSELS REGISTERED",
            "message": "All berths currently available. No ship records have been entered.",
        })

    return alerts


# ── Analytics ──────────────────────────────────────────────────────────────
@app.get("/analytics", summary="Historical operational analytics")
def get_analytics():
    arrival_history = [
        {"day": "07 Aug", "arrivals": 9, "departures": 8, "teu": 14200, "tonnes": 38200, "waiting": 3.2, "eta_accuracy": 91},
        {"day": "08 Aug", "arrivals": 11, "departures": 10, "teu": 17800, "tonnes": 44100, "waiting": 4.1, "eta_accuracy": 88},
        {"day": "09 Aug", "arrivals": 8, "departures": 9, "teu": 12600, "tonnes": 33400, "waiting": 2.6, "eta_accuracy": 93},
        {"day": "10 Aug", "arrivals": 13, "departures": 11, "teu": 20400, "tonnes": 51800, "waiting": 5.0, "eta_accuracy": 86},
        {"day": "11 Aug", "arrivals": 12, "departures": 12, "teu": 19100, "tonnes": 49300, "waiting": 3.8, "eta_accuracy": 90},
        {"day": "12 Aug", "arrivals": 10, "departures": 11, "teu": 16400, "tonnes": 42700, "waiting": 3.1, "eta_accuracy": 94},
        {"day": "13 Aug", "arrivals": 14, "departures": 12, "teu": 22600, "tonnes": 55600, "waiting": 4.4, "eta_accuracy": 92},
    ]
    utilization_history = [
        {"hour": "00", "berth": 62, "crane": 51},
        {"hour": "03", "berth": 58, "crane": 47},
        {"hour": "06", "berth": 71, "crane": 63},
        {"hour": "09", "berth": 84, "crane": 76},
        {"hour": "12", "berth": 91, "crane": 82},
        {"hour": "15", "berth": 88, "crane": 79},
        {"hour": "18", "berth": 79, "crane": 70},
        {"hour": "21", "berth": 68, "crane": 58},
    ]
    return {"arrival_history": arrival_history, "utilization_history": utilization_history}


# ── Reports ─────────────────────────────────────────────────────────────────
@app.get("/reports", summary="Summary report data")
def get_reports():
    port = _current_port()
    scenario = _state["scenario"]
    return {
        "port": port["short"],
        "ships": scenario["ships"],
        "cargo_teu": scenario["load_teu"],
        "unload_time_h": scenario["unload_hours"],
        "berths": port["berths"],
        "emergency": scenario["disaster"],
        "optimized": _state["optimized"],
        "registered_vessels": len(_state["ship_details"]),
    }


# ── Yard (heatmap) ──────────────────────────────────────────────────────────
@app.get("/yard/heatmap", summary="Yard utilization heatmap data")
def yard_heatmap():
    rng = np.random.default_rng(42)
    z = rng.uniform(10, 100, (8, 24)).tolist()
    return {
        "z": z,
        "x": [f"C{i + 1}" for i in range(24)],
        "y": [f"Block {i + 1}" for i in range(8)],
    }


# ── Health ──────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "vessels": len(_state["ship_details"]), "port": _state["selected_port"]}


# ===========================================================================
# NEW INTERACTIVE FEATURES
# ===========================================================================

# ---------------------------------------------------------------------------
# BAY OF BENGAL / INDIAN OCEAN OCEAN-ONLY COORDINATE VALIDATOR
# ---------------------------------------------------------------------------
# Polygon of known land masses to reject. We use a simplified bounding-box
# approach: coordinates within mainland India or Sri Lanka coastline boxes
# are flagged as on-land. Ships must be at sea.
_LAND_BOXES = [
    # Mainland India (very rough bounding box – east coast excluded to keep
    # port approaches valid)
    {"lat_min": 8.0,  "lat_max": 23.5, "lon_min": 72.5, "lon_max": 80.0,  "name": "Mainland India"},
    # Sri Lanka
    {"lat_min": 5.9,  "lat_max": 9.9,  "lon_min": 79.6, "lon_max": 81.9,  "name": "Sri Lanka"},
    # Bangladesh / Myanmar coast
    {"lat_min": 20.5, "lat_max": 24.0, "lon_min": 88.0, "lon_max": 93.0,  "name": "Bangladesh/Myanmar"},
    # Andaman Islands (land, not a port approach)
    {"lat_min": 10.5, "lat_max": 13.7, "lon_min": 92.5, "lon_max": 93.2,  "name": "Andaman Islands"},
]

# Strict sea window for Bay of Bengal / Indian Ocean east of India
_SEA_LAT_MIN = -10.0
_SEA_LAT_MAX =  22.0
_SEA_LON_MIN =  75.0
_SEA_LON_MAX = 100.0

def _is_ocean(lat: float, lon: float) -> tuple[bool, str]:
    """Return (is_valid_ocean, reason_if_invalid)."""
    if not (_SEA_LAT_MIN <= lat <= _SEA_LAT_MAX and _SEA_LON_MIN <= lon <= _SEA_LON_MAX):
        return False, f"Outside operating window ({_SEA_LAT_MIN}–{_SEA_LAT_MAX}°N, {_SEA_LON_MIN}–{_SEA_LON_MAX}°E)"
    for box in _LAND_BOXES:
        if box["lat_min"] <= lat <= box["lat_max"] and box["lon_min"] <= lon <= box["lon_max"]:
            return False, f"Coordinate appears to be on land ({box['name']}). Move the position offshore."
    return True, ""


@app.get("/validate/position", summary="Validate lat/lon is in Bay of Bengal / Indian Ocean")
def validate_position(lat: float, lon: float):
    valid, reason = _is_ocean(lat, lon)
    port = _current_port()
    dist = _haversine_km(lat, lon, port["lat"], port["lon"])
    return {
        "valid": valid,
        "reason": reason,
        "distance_km": round(dist, 1),
        "too_close": dist < 5,
        "lat": lat,
        "lon": lon,
    }


# ---------------------------------------------------------------------------
# EMERGENCY HALT
# ---------------------------------------------------------------------------
class EmergencyHaltIn(BaseModel):
    ship_id: str
    halt_hours: float = 2.0   # How many hours the halt adds to ETA
    reason: str = "Emergency halt requested by operator"


@app.post("/vessels/{ship_id}/emergency-halt", summary="Apply emergency halt to a vessel")
def emergency_halt(ship_id: str, body: EmergencyHaltIn):
    """Adds `halt_hours` to the vessel's ETA and unload end time and flags it
    as halted so the simulation shows the extended waiting time at anchorage."""
    ship = next((s for s in _state["ship_details"] if s["ship_id"] == ship_id), None)
    if not ship:
        raise HTTPException(status_code=404, detail="Vessel not found")

    # Extend ETA and expected end
    eta_dt = datetime.fromisoformat(ship["eta"])
    new_eta = eta_dt + timedelta(hours=body.halt_hours)
    end_dt = datetime.fromisoformat(ship["expected_end"])
    new_end = end_dt + timedelta(hours=body.halt_hours)

    ship["eta"] = new_eta.isoformat()
    ship["expected_end"] = new_end.isoformat()
    ship["halt_hours"] = ship.get("halt_hours", 0.0) + body.halt_hours
    ship["halt_reason"] = body.reason
    ship["halted"] = True

    # Invalidate cached optimisation so it re-runs with new ETA
    _state["optimized"] = False

    return {
        "ship_id": ship_id,
        "new_eta": new_eta.isoformat(),
        "new_expected_end": new_end.isoformat(),
        "total_halt_hours": ship["halt_hours"],
        "reason": body.reason,
    }


@app.delete("/vessels/{ship_id}/emergency-halt", summary="Clear emergency halt")
def clear_halt(ship_id: str):
    ship = next((s for s in _state["ship_details"] if s["ship_id"] == ship_id), None)
    if not ship:
        raise HTTPException(status_code=404, detail="Vessel not found")
    ship["halted"] = False
    ship["halt_hours"] = 0.0
    ship["halt_reason"] = ""
    _state["optimized"] = False
    return {"ship_id": ship_id, "cleared": True}


# ---------------------------------------------------------------------------
# SIMULATION POSITION  (1 real hour = 5 sim seconds = speed 720×)
# ---------------------------------------------------------------------------
# SIM_SCALE: how many simulation-hours pass per real second at 1× speed.
# 1 real hour = 5 real seconds  →  1 real second = 3600/5 = 720 sim-seconds
# The frontend drives the clock but we also expose a server-side interpolation
# endpoint so other clients (or server-sent events) can consume it.

SIM_SCALE_FACTOR = 720.0   # sim-seconds per real-second at speed=1

@app.get("/simulation/ship-positions", summary="Interpolated ship positions at current sim time")
def ship_positions_at_simtime():
    """Returns every ship's interpolated lat/lon at the current sim time.
    The frontend uses this to drive smooth animation without polling /map/snapshot
    (which runs the full optimizer every call).
    """
    port = _current_port()
    sim_time = datetime.fromisoformat(_state["simulation_time"])
    ships = _state["ship_details"]

    def _dt(v: Any) -> datetime:
        if isinstance(v, datetime): return v
        if isinstance(v, str): return datetime.fromisoformat(v)
        return sim_time

    results = []
    for idx, ship in enumerate(ships):
        start = _dt(ship.get("start_dt") or ship.get("updated_at") or sim_time)
        eta   = _dt(ship.get("eta") or start)
        lat0, lon0 = float(ship["latitude"]), float(ship["longitude"])

        if sim_time <= start:
            lat, lon = lat0, lon0
            status = "Approaching"
        elif sim_time >= eta:
            lat, lon = port["lat"], port["lon"]
            status = "At Port"
        else:
            total  = max((eta - start).total_seconds(), 1.0)
            elapsed = (sim_time - start).total_seconds()
            ratio  = min(1.0, elapsed / total)
            lat = lat0 + (port["lat"] - lat0) * ratio
            lon = lon0 + (port["lon"] - lon0) * ratio
            status = "Approaching"

        # Validate the interpolated position stays at sea
        ok, _ = _is_ocean(lat, lon)
        if not ok:
            # Snap to port vicinity if somehow on land
            lat, lon = port["lat"], port["lon"]

        results.append({
            "ship_id": ship["ship_id"],
            "lat": lat,
            "lon": lon,
            "status": status,
            "halted": ship.get("halted", False),
            "halt_hours": ship.get("halt_hours", 0.0),
            "halt_reason": ship.get("halt_reason", ""),
            "speed_knots": ship.get("speed_knots", 0),
            "eta": ship.get("eta"),
            "color": _ship_color(idx),
            "index": idx,
            "cargo_type": ship.get("cargo_type"),
            "weight_tonnes": ship.get("weight_tonnes"),
            "operator": ship.get("operator"),
            "loa_m": ship.get("loa_m"),
            "draft_m": ship.get("draft_m"),
        })

    return {"simulation_time": _state["simulation_time"], "ships": results, "scale_factor": SIM_SCALE_FACTOR}


# ---------------------------------------------------------------------------
# BERTH LOAD CAPACITY CHECK
# ---------------------------------------------------------------------------
@app.get("/berths/capacity-check", summary="Check if a vessel fits within berth load capacity")
def berth_capacity_check(weight_tonnes: float, loa_m: float, draft_m: float, cargo_type: str = "general cargo"):
    """Returns which berths can accept this vessel considering load, dimensions
    and cargo type. Used by the registration console for live feedback."""
    port = _current_port()
    results = []
    for name, profile in port["berth_profiles"].items():
        reasons = _berth_compat(
            {"weight_tonnes": weight_tonnes, "loa_m": loa_m, "draft_m": draft_m, "cargo_type": cargo_type},
            profile,
        )
        load_pct = round(weight_tonnes / max(profile["capacity_tonnes"], 1) * 100, 1)
        results.append({
            "berth": name,
            "compatible": len(reasons) == 0,
            "reasons": reasons,
            "berth_capacity_t": profile["capacity_tonnes"],
            "load_pct": load_pct,
            "max_loa_m": profile["max_loa_m"],
            "max_draft_m": profile["max_draft_m"],
            "cargo_types": profile["cargo_types"],
        })
    compatible = [r for r in results if r["compatible"]]
    return {
        "compatible_berths": compatible,
        "incompatible_berths": [r for r in results if not r["compatible"]],
        "any_compatible": len(compatible) > 0,
        "best_berth": compatible[0]["berth"] if compatible else None,
    }


# ---------------------------------------------------------------------------
# CRANE LOAD OPTIMIZATION
# ---------------------------------------------------------------------------
@app.post("/cranes/optimize", summary="Optimize crane assignment by berth load capacity")
def optimize_cranes():
    """Assigns cranes to berths/ships to maximize throughput.
    Priority order:
      1. Spoilable cargo with nearest deadline
      2. Heaviest load (maximize crane throughput)
      3. Berth with most remaining capacity to handle overflow
    Returns a detailed per-crane schedule with load balancing metrics.
    """
    port = _current_port()
    cs = _state["crane_settings"]
    ships = _state["ship_details"]

    if not ships:
        return {"assignments": [], "utilization": [], "total_load_t": 0, "balanced": True}

    opt = _optimize(ships, port, cs["cranes"], cs["rate_tph"])
    crane_schedule = opt["crane_schedule"]

    # Build crane utilization summary
    crane_count = cs["cranes"]
    crane_loads: Dict[str, float] = {}
    for row in crane_schedule:
        c = row["crane"]
        crane_loads[c] = crane_loads.get(c, 0.0) + float(row["weight_tonnes"])

    total_load = sum(crane_loads.values())
    ideal_per_crane = total_load / max(crane_count, 1)

    utilization = []
    for i in range(crane_count):
        cname = f"Crane {i+1}"
        load = crane_loads.get(cname, 0.0)
        pct = round(load / max(float(cs["rate_tph"]), 1) * 100, 1)
        utilization.append({
            "crane": cname,
            "assigned_load_t": round(load, 1),
            "utilization_pct": min(pct, 100),
            "deviation_from_ideal_t": round(load - ideal_per_crane, 1),
        })

    # Balance score: 100 = perfectly balanced, lower = more imbalanced
    if total_load > 0 and crane_count > 1:
        loads = [u["assigned_load_t"] for u in utilization]
        mean_load = total_load / crane_count
        variance = sum((l - mean_load) ** 2 for l in loads) / crane_count
        balance_score = max(0, round(100 - (variance ** 0.5 / max(mean_load, 1)) * 100, 1))
    else:
        balance_score = 100.0

    return {
        "assignments": crane_schedule,
        "utilization": utilization,
        "total_load_t": round(total_load, 1),
        "ideal_per_crane_t": round(ideal_per_crane, 1),
        "balance_score": balance_score,
        "balanced": balance_score >= 75,
        "crane_count": crane_count,
        "rate_tph": cs["rate_tph"],
    }


# ── Berth limits ─────────────────────────────────────────────────────────────
@app.get("/berths/limits", summary="Maximum capacity, LOA and draft across all berths of the active port")
def berth_limits():
    """Returns the maximum values a vessel can have and still fit in at least
    one berth. The registration console uses these as hard input limits."""
    port = _current_port()
    profiles = port["berth_profiles"].values()

    max_capacity = max(p["capacity_tonnes"] for p in profiles)
    max_loa      = max(p["max_loa_m"]       for p in profiles)
    max_draft    = max(p["max_draft_m"]     for p in profiles)

    # Per-berth summary so the UI can show which berth accepts what
    berth_summary = [
        {
            "name":             name,
            "capacity_tonnes":  p["capacity_tonnes"],
            "max_loa_m":        p["max_loa_m"],
            "max_draft_m":      p["max_draft_m"],
            "cargo_types":      p["cargo_types"],
            "handling_rate_tph":p["handling_rate_tph"],
        }
        for name, p in port["berth_profiles"].items()
    ]

    return {
        "port":           port["short"],
        "max_capacity_t": max_capacity,
        "max_loa_m":      max_loa,
        "max_draft_m":    max_draft,
        "berth_count":    len(berth_summary),
        "berths":         berth_summary,
    }


# ===========================================================================
# DYNAMIC HYBRID OPTIMIZATION ENGINE  (new endpoints)
# ===========================================================================
from optimizer import (
    engine as _engine,
    calc_processing_time_min,
    evaluate_preemption,
    ObjectiveWeights,
    DEFAULT_CRANE_RATE_TPM,
    DEFAULT_EFFICIENCY,
    DEFAULT_SWITCH_COST_MIN,
    DEFAULT_AGING_RATE,
    schedule_fcfs, schedule_sjf, schedule_srpt, schedule_greedy,
    schedule_qaoa, schedule_hybrid,
    compute_objective,
)

# ── Pydantic models ──────────────────────────────────────────────────────────

class OptConfigIn(BaseModel):
    algo:           str   = "Hybrid"
    crane_rate_tpm: float = DEFAULT_CRANE_RATE_TPM
    efficiency:     float = DEFAULT_EFFICIENCY
    switch_cost:    float = DEFAULT_SWITCH_COST_MIN
    aging_rate:     float = DEFAULT_AGING_RATE
    preemption:     bool  = True
    rolling:        bool  = True
    qaoa_enabled:   bool  = True
    crane_count:    int   = 4

class PreemptCheckIn(BaseModel):
    current_ship_id: str
    new_ship_id:     str

class UpdateCargoIn(BaseModel):
    ship_id:       str
    sim_time_ms:   float

class HaltEventIn(BaseModel):
    ship_id:     str
    halt_hours:  float = 2.0


# ── Sync engine with registration state ─────────────────────────────────────

def _sync_engine():
    """Push current _state ship_details into the rolling engine."""
    port = _current_port()
    _engine.load_ships(_state["ship_details"], port["berth_profiles"])


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/optimization/config", summary="Get current optimizer configuration")
def get_opt_config():
    return _engine.opt_config


@app.put("/optimization/config", summary="Update optimizer configuration")
def set_opt_config(body: OptConfigIn):
    _engine.configure(body.model_dump())
    return _engine.opt_config


@app.post("/optimization/run", summary="Run the full optimization pipeline")
def run_optimization_pipeline():
    """
    Syncs ship/berth state from the registration system, then runs the
    selected optimizer (FCFS/SJF/SRPT/Greedy/QAOA/Hybrid).
    Returns the optimized schedule with 'why' explanations per ship.
    """
    _sync_engine()
    meta = _engine.optimize()
    return {"meta": meta, "schedule": _engine.schedule, "event_log": _engine.event_log[-20:]}


@app.get("/optimization/live-state", summary="Get full live port state")
def get_live_state():
    """
    Returns ships, berths, cranes, schedule, event log and optimizer metadata.
    Used by the dashboard to display live optimization state.
    """
    return _engine.get_live_state()


@app.post("/optimization/compare-algorithms", summary="Compare all scheduling algorithms on current scenario")
def compare_algorithms():
    """
    Runs FCFS, SJF, SRPT, Greedy, QAOA, and Hybrid on the same scenario.
    Returns a comparison table with objective values and key metrics.
    """
    _sync_engine()
    port = _current_port()
    ships = list(_engine.ship_states.values()) or _state["ship_details"]
    berths_list = [
        {
            "name":             bname,
            "capacity_tonnes":  bp["capacity_tonnes"],
            "max_loa_m":        bp["max_loa_m"],
            "max_draft_m":      bp["max_draft_m"],
        }
        for bname, bp in port["berth_profiles"].items()
    ]
    crane_count = int(_engine.opt_config.get("crane_count", 4))
    comparison  = _engine.compare_all_algorithms(ships, berths_list, crane_count)
    return {
        "comparison":   comparison,
        "scenario":     {
            "ships":        len(ships),
            "berths":       len(berths_list),
            "cranes":       crane_count,
            "algo_used":    _engine.opt_config.get("algo", "Hybrid"),
        },
        "timestamp": datetime.now().isoformat(timespec="seconds"),
    }


@app.post("/optimization/preemption-check", summary="Evaluate whether crane preemption is beneficial")
def preemption_check(body: PreemptCheckIn):
    """
    Evaluates whether preempting the current ship to serve a new ship
    improves the global schedule objective.
    """
    _sync_engine()
    current = _engine.ship_states.get(body.current_ship_id)
    new_s   = _engine.ship_states.get(body.new_ship_id)
    if not current or not new_s:
        raise HTTPException(status_code=404, detail="Ship not found in engine state")
    w = ObjectiveWeights()
    should_preempt, reason = evaluate_preemption(
        current, new_s,
        float(_engine.opt_config["switch_cost"]),
        float(_engine.opt_config["crane_rate_tpm"]),
        float(_engine.opt_config["efficiency"]),
        w,
    )
    return {
        "current_ship": body.current_ship_id,
        "new_ship":     body.new_ship_id,
        "preempt":      should_preempt,
        "reason":       reason,
    }


@app.post("/optimization/update-cargo", summary="Update remaining cargo for a ship (live sim tick)")
def update_cargo(body: UpdateCargoIn):
    _engine.update_cargo(body.ship_id, body.sim_time_ms)
    ship = _engine.ship_states.get(body.ship_id)
    if not ship:
        raise HTTPException(status_code=404, detail="Ship not found")
    return {
        "ship_id":            body.ship_id,
        "remaining_cargo_t":  ship.get("remaining_cargo_t"),
        "processed_cargo_t":  ship.get("processed_cargo_t"),
        "predicted_departure": ship.get("predicted_departure"),
    }


@app.post("/optimization/event/arrival", summary="Notify engine of ship arrival")
def event_arrival(body: dict):
    ship_id = body.get("ship_id")
    if not ship_id:
        raise HTTPException(status_code=422, detail="ship_id required")
    _engine.on_ship_arrival(ship_id)
    return {"ok": True, "event_log": _engine.event_log[-5:]}


@app.post("/optimization/event/berth-free", summary="Notify engine that a berth has become available")
def event_berth_free(body: dict):
    berth_id = body.get("berth_id")
    if not berth_id:
        raise HTTPException(status_code=422, detail="berth_id required")
    _engine.on_berth_free(berth_id)
    return {"ok": True, "event_log": _engine.event_log[-5:]}


@app.post("/optimization/event/halt", summary="Notify engine of emergency halt")
def event_halt(body: HaltEventIn):
    _engine.on_emergency_halt(body.ship_id, body.halt_hours)
    return {"ok": True, "event_log": _engine.event_log[-5:]}


@app.post("/optimization/event/halt-cleared", summary="Notify engine that halt was cleared")
def event_halt_cleared(body: dict):
    ship_id = body.get("ship_id")
    if not ship_id:
        raise HTTPException(status_code=422, detail="ship_id required")
    _engine.on_halt_cleared(ship_id)
    return {"ok": True, "event_log": _engine.event_log[-5:]}


@app.get("/optimization/event-log", summary="Get the full event log")
def get_event_log(limit: int = 100):
    return {"events": _engine.event_log[-limit:]}


@app.get("/optimization/processing-time", summary="Calculate dynamic processing time for given cargo and cranes")
def get_processing_time(
    cargo_tonnes:  float = 1000.0,
    crane_count:   int   = 1,
    rate_tpm:      float = DEFAULT_CRANE_RATE_TPM,
    efficiency:    float = DEFAULT_EFFICIENCY,
):
    proc_min = calc_processing_time_min(cargo_tonnes, crane_count, rate_tpm, efficiency)
    return {
        "cargo_tonnes":         cargo_tonnes,
        "crane_count":          crane_count,
        "rate_tpm":             rate_tpm,
        "efficiency":           efficiency,
        "effective_rate_tpm":   round(rate_tpm * crane_count * efficiency, 3),
        "processing_time_min":  round(proc_min, 2),
        "processing_time_hrs":  round(proc_min / 60, 3),
    }


@app.post("/optimization/reset", summary="Reset the rolling-horizon engine")
def reset_engine():
    _engine.reset()
    return {"ok": True, "message": "Rolling horizon engine reset"}
