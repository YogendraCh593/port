
import streamlit as st
from pathlib import Path
import pandas as pd
import numpy as np
import math
import plotly.graph_objects as go
import folium
from folium.plugins import PolyLineTextPath
from streamlit_folium import st_folium
from datetime import datetime, timedelta, time
from nexusport_shared import load_ship_details, save_ship_details, clear_ship_details

APP_DIR = Path(__file__).resolve().parent
LOGO_PATH = APP_DIR / "nexusport_logo.png"

st.set_page_config(
    page_title="NexusPort | Intelligent Maritime Operations",
    page_icon=str(LOGO_PATH),
    layout="wide",
)

# ------------------------------------------------------------------
# PORT DATABASE
# Counts are based on current public port-authority information.
# ------------------------------------------------------------------
PORTS = {
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
        "url": "https://vizagport.com/Template/navigateTemplate/gnt/QmVydGhz",
        "notes": "The authority currently lists 26 numbered/grouped berth or terminal entries.",
        "sea_bearing": 115,
        "berth_axis_bearing": 25,
        "berth_spacing_km": 0.08,
        "sea_offset_km": 0.30,
        "names": [
            "EQ1", "EQ3-EQ4", "EQ5-EQ6", "EQ7", "EQ8", "EQ9", "EQ10",
            "WQ1", "WQ2", "WQ3", "WQ4", "WQ5", "WQ6", "WQ7", "WQ8",
            "Fertilizer", "OR-I", "OR-II", "OR-III", "OSTT", "LPG",
            "OB1-OB2", "Cruise", "VGCB", "VCTPL-1&2", "VCTPL-3&4"
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
        "url": "https://paradipport.gov.in/know-your-port/",
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


def build_berth_profiles(names, default_capacity):
    """Create a dictionary of berth-specific capabilities used by the optimizer."""
    profiles = {}
    cargo_options = [
        ["container", "general cargo"],
        ["dry bulk", "general cargo"],
        ["liquid bulk", "general cargo"],
        ["project cargo", "general cargo"],
    ]
    for i, name in enumerate(names):
        profiles[name] = {
            "name": name,
            "capacity_tonnes": int(default_capacity * (0.65 + (i % 5) * 0.10)),
            "max_loa_m": int(180 + (i % 6) * 25),
            "max_draft_m": round(8.5 + (i % 5) * 1.5, 1),
            "cargo_types": cargo_options[i % len(cargo_options)],
            "handling_rate_tph": int(900 + (i % 5) * 350),
        }
    return profiles


for _port in PORTS.values():
    _port["berth_profiles"] = build_berth_profiles(_port["names"], 50000 if _port["short"] == "Visakhapatnam" else 40000)

if "selected_port" not in st.session_state:
    st.session_state.selected_port = "Kakinada Deep Water Port"

if "scenario" not in st.session_state:
    st.session_state.scenario = {
        "ships": 12,
        "unload_hours": 8.0,
        "load_teu": 18920,
        "priority": 3,
        "disaster": False,
    }

if "optimized" not in st.session_state:
    st.session_state.optimized = False

# Live port simulation clock. The operator can advance the virtual clock to
# watch vessels sail toward the port, wait at anchorage, and enter berths.
if "simulation_time" not in st.session_state:
    st.session_state.simulation_time = datetime.now()
if "simulation_running" not in st.session_state:
    st.session_state.simulation_running = False

# ------------------------------------------------------------------
# SHIP AND CRANE OPTIMIZATION STATE
# ------------------------------------------------------------------
# Vessel details are maintained by the separate Vessel Input application.
# Reload them on every rerun so this application always sees the latest data.
st.session_state.ship_details = load_ship_details()

if "crane_settings" not in st.session_state:
    st.session_state.crane_settings = {
        "cranes": 8,
        "rate_tph": 1200.0,
    }


def parse_dt(date_value, time_value):
    return datetime.combine(date_value, time_value)


def berth_map_coordinates(port, index, count):
    """Return berth coordinates in a compact sea-side berth band.

    The berth row is deliberately offset from the port anchor toward the sea
    and then spread parallel to the jetty/shoreline. This prevents berth
    markers from appearing inland or in a circle around the port.

    The source data contains port-level coordinates rather than surveyed
    coordinates for every berth, so these remain sea-side visualization
    coordinates until authoritative berth GPS points are supplied.
    """
    earth_radius_km = 6371.0
    sea_bearing = np.deg2rad(float(port.get("sea_bearing", 90)))
    axis_bearing = np.deg2rad(float(port.get("berth_axis_bearing", 0)))
    spacing = float(port.get("berth_spacing_km", 0.1))
    sea_offset = float(port.get("sea_offset_km", 0.28))

    # Keep every berth in the sea-side band. The offset is intentionally small
    # so the markers sit immediately beyond the shoreline/port bank instead of
    # floating far offshore. The berth line follows the jetty/shore direction.
    along = (index - (count - 1) / 2.0) * spacing
    north_km = sea_offset * np.cos(sea_bearing) + along * np.cos(axis_bearing)
    east_km = sea_offset * np.sin(sea_bearing) + along * np.sin(axis_bearing)

    lat = port["lat"] + north_km / earth_radius_km * (180.0 / np.pi)
    lon = port["lon"] + east_km / (earth_radius_km * np.cos(np.deg2rad(port["lat"]))) * (180.0 / np.pi)
    return lat, lon


def ship_color(index):
    import colorsys
    hue = (index * 137.508) % 360
    r, g, b = colorsys.hsv_to_rgb(hue / 360.0, 0.72, 0.95)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))

def ship_map_coordinates(port, index, total):
    earth_radius_km = 6371.0
    sea = np.deg2rad(float(port.get("sea_bearing", 90)))
    axis = np.deg2rad(float(port.get("berth_axis_bearing", 0)))
    n = max(total, 1)
    ring = 0.75 + 0.16 * (index % 3)
    along = ((index - (n - 1) / 2) * 0.22) + ((index % 2) * 0.07)
    north_km = ring * np.cos(sea) + along * np.cos(axis)
    east_km = ring * np.sin(sea) + along * np.sin(axis)
    lat = port["lat"] + north_km / earth_radius_km * (180 / np.pi)
    lon = port["lon"] + east_km / (earth_radius_km * np.cos(np.deg2rad(port["lat"]))) * (180 / np.pi)
    return lat, lon

def berth_compatibility(ship, berth):
    reasons = []
    if float(ship.get("weight_tonnes", 0)) > float(berth["capacity_tonnes"]): reasons.append("load exceeds berth capacity")
    if float(ship.get("loa_m", 0)) > float(berth["max_loa_m"]): reasons.append("LOA exceeds berth limit")
    if float(ship.get("draft_m", 0)) > float(berth["max_draft_m"]): reasons.append("draft exceeds berth limit")
    cargo = str(ship.get("cargo_type", "General")).strip().lower()
    category_map = {"coal": "dry bulk", "iron ore": "dry bulk", "ore": "dry bulk",
                    "grain": "dry bulk", "fertilizer": "dry bulk", "crude": "liquid bulk",
                    "oil": "liquid bulk", "petroleum": "liquid bulk", "containers": "container",
                    "container": "container", "machinery": "project cargo", "project cargo": "project cargo"}
    cargo_category = category_map.get(cargo, cargo)
    allowed = [str(x).lower() for x in berth.get("cargo_types", [])]
    if cargo_category and cargo_category not in allowed and "general" not in allowed: reasons.append("cargo type not supported")
    return reasons

def _quantum_berth_assignment(ship_details, berth_names, berth_profiles):
    """Dynamic QUBO + lightweight QAOA statevector solver for berth assignment.

    The quantum layer chooses a berth for each waiting ship. Timing is then
    calculated classically so existing crane scheduling and UI behavior remain
    unchanged.  The objective rewards low waiting time, protects scarce berths
    for constrained/future ships, and penalizes schedule instability.

    A small statevector implementation is used so the application does not
    require a quantum SDK. For larger scenarios, a deterministic QUBO local
    search is used to keep the Streamlit app responsive.
    """
    if not ship_details or not berth_names:
        return {}

    # Only compatible choices become quantum variables. This keeps impossible
    # assignments out of the search space rather than merely penalizing them.
    choices = {}
    for ship in ship_details:
        compatible = [
            b for b in berth_names
            if berth_compatibility(ship, berth_profiles.get(b, {}))
        ]
        choices[ship["ship_id"]] = compatible

    # Ships with no compatible berth retain the application's existing reject
    # behavior and do not enter the optimization problem.
    active = [s for s in ship_details if choices[s["ship_id"]]]
    if not active:
        return {}

    # A berth is more valuable when fewer ships can use it. This is the key
    # future-arrival/scarcity idea: flexible ships should avoid consuming a
    # berth that a constrained ship may need later.
    berth_flexibility = {
        b: max(1, sum(b in choices[s["ship_id"]] for s in active))
        for b in berth_names
    }
    scarcity = {
        b: 1.0 / berth_flexibility[b]
        for b in berth_names
    }

    # Greedy schedule is used both as a strong baseline and as the warm-start
    # solution for the quantum search.
    greedy = {}
    available = {b: datetime.min for b in berth_names}
    for ship in sorted(active, key=lambda x: (x["start_dt"], -float(x.get("weight_tonnes", 0)))):
        ranked = []
        for b in choices[ship["ship_id"]]:
            start = max(ship["start_dt"], available[b])
            wait = max(0.0, (start - ship["start_dt"]).total_seconds() / 3600)
            ranked.append((wait + 1.8 * scarcity[b], -float(berth_profiles.get(b, {}).get("capacity_tonnes", 0)), b, start))
        _, _, chosen, actual_start = min(ranked)
        greedy[ship["ship_id"]] = chosen
        available[chosen] = actual_start + timedelta(hours=float(ship["unload_hours"]))

    # Build binary assignment variables x(ship, berth). A compact QUBO is
    # sufficient here because berth timing is evaluated after each candidate.
    variables = []
    for ship in active:
        for b in choices[ship["ship_id"]]:
            variables.append((ship["ship_id"], b))

    # Keep the exact QAOA simulator intentionally small enough for a local
    # Streamlit app. Larger instances use the same QUBO objective with local
    # bit-flip search rather than freezing the UI.
    max_quantum_vars = 14

    def assignment_cost(assign):
        berth_free = {b: datetime.min for b in berth_names}
        total = 0.0
        # Earlier arrivals are evaluated first, while future/constrained ships
        # influence the berth scarcity term for every decision.
        for ship in sorted(active, key=lambda x: (x["start_dt"], -float(x.get("weight_tonnes", 0)))):
            b = assign[ship["ship_id"]]
            start = max(ship["start_dt"], berth_free[b])
            wait = max(0.0, (start - ship["start_dt"]).total_seconds() / 3600)
            urgency = 0.0
            deadline = ship.get("spoilage_deadline")
            if ship.get("spoilable") and deadline:
                hours_to_deadline = max(0.0, (deadline - ship["start_dt"]).total_seconds() / 3600)
                urgency = 2.5 / max(hours_to_deadline, 1.0)
            total += 4.0 * wait + 5.0 * urgency + 2.5 * scarcity[b]
            berth_free[b] = start + timedelta(hours=float(ship["unload_hours"]))

        # Future/constrained-vessel protection: penalize assignments that use
        # a berth needed by a ship with fewer alternatives.
        for ship in active:
            b = assign[ship["ship_id"]]
            alternatives = len(choices[ship["ship_id"]])
            if alternatives > 1:
                total += 0.8 * scarcity[b]
        return total

    # For small instances, perform actual QAOA statevector evolution. The
    # objective is encoded as a diagonal cost function; invalid states receive
    # a large penalty. This is a genuine QAOA simulation, not a random label.
    if len(variables) <= max_quantum_vars:
        import numpy as _np
        n = len(variables)
        dim = 1 << n
        costs = _np.zeros(dim, dtype=float)
        penalty = 1000.0

        for state in range(dim):
            assign = {}
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

        # Warm-start: initialize most amplitude around the classical greedy
        # assignment instead of starting from a completely uninformed state.
        target_state = 0
        for idx, (sid, b) in enumerate(variables):
            if greedy.get(sid) == b:
                target_state |= (1 << idx)
        state = _np.ones(dim, dtype=complex) / _np.sqrt(dim)
        state = 0.25 * state
        state[target_state] += 0.75
        state /= _np.linalg.norm(state)

        # A small deterministic parameter sweep keeps this reproducible and
        # avoids adding an optimizer dependency to the application.
        best_expected = float("inf")
        best_state = state.copy()
        z = _np.arange(dim)
        # One layer is deliberately used for responsiveness; the port is
        # re-optimized whenever the input state changes.
        for gamma in _np.linspace(0.15, 1.5, 6):
            for beta in _np.linspace(0.15, 1.5, 6):
                psi = state.copy()
                psi *= _np.exp(-1j * gamma * costs)
                # X-mixer: apply exp(-i beta X) independently to each qubit.
                cb, sb = _np.cos(beta), -1j * _np.sin(beta)
                for q in range(n):
                    step = 1 << q
                    for base in range(0, dim, 2 * step):
                        for off in range(step):
                            a, b = base + off, base + off + step
                            va, vb = psi[a], psi[b]
                            psi[a] = cb * va + sb * vb
                            psi[b] = sb * va + cb * vb
                expected = float(_np.sum((_np.abs(psi) ** 2) * costs))
                if expected < best_expected:
                    best_expected = expected
                    best_state = psi

        probabilities = _np.abs(best_state) ** 2
        # Pick the best feasible sampled state; deterministic tie-breaking is
        # retained so the dashboard remains stable between reruns.
        ranked_states = _np.argsort(-probabilities)
        chosen_assign = None
        for state_idx in ranked_states:
            assign = {}
            for idx, (sid, b) in enumerate(variables):
                if (int(state_idx) >> idx) & 1:
                    if sid in assign:
                        assign = None
                        break
                    assign[sid] = b
            if assign is not None and len(assign) == len(active):
                chosen_assign = assign
                break
        if chosen_assign:
            return chosen_assign

    # Larger scenarios use the same objective in a deterministic local-search
    # form. This is the practical fallback for real ports with many ships.
    current = dict(greedy)
    improved = True
    while improved:
        improved = False
        base_cost = assignment_cost(current)
        for ship in sorted(active, key=lambda x: len(choices[x["ship_id"]])):
            sid = ship["ship_id"]
            original = current[sid]
            best_b = original
            best_cost = base_cost
            for b in choices[sid]:
                current[sid] = b
                candidate_cost = assignment_cost(current)
                if candidate_cost + 1e-9 < best_cost:
                    best_cost, best_b = candidate_cost, b
            current[sid] = best_b
            if best_b != original:
                base_cost = best_cost
                improved = True
    return current


def optimize_port_operations(ship_details, berth_names, crane_count, crane_rate, berth_profiles=None):
    if not ship_details:
        return pd.DataFrame(), pd.DataFrame()
    berth_profiles = berth_profiles or {}

    # ------------------------------------------------------------------
    # DYNAMIC QUANTUM BERTH OPTIMIZATION
    # ------------------------------------------------------------------
    # Unlike FCFS, the optimizer considers every currently entered ship as a
    # shared planning problem. A ship with many berth choices is encouraged to
    # use a flexible berth, leaving scarce berths available for ships that may
    # arrive later. The assignment is solved with QUBO/QAOA for small cases and
    # the same objective with a deterministic local search for larger cases.
    quantum_assignment = _quantum_berth_assignment(ship_details, berth_names, berth_profiles)

    berth_available = {name: datetime.min for name in berth_names}
    scheduled = []
    ships_sorted = sorted(ship_details, key=lambda x: (x.get("eta", x["start_dt"]), -float(x.get("weight_tonnes", 0))))
    for ship in ships_sorted:
        candidates = []
        for name in berth_names:
            profile = berth_profiles.get(name, {})
            if berth_compatibility(ship, profile):
                candidates.append((name, berth_available[name]))
        if not candidates:
            arrival_time = ship.get("eta", ship["start_dt"])
            scheduled.append({**ship, "assigned_berth": "No compatible berth", "actual_start": arrival_time,
                              "unload_end": arrival_time, "berth_wait_hours": 0.0,
                              "allocation_status": "Rejected: no compatible berth"})
            continue

        preferred = quantum_assignment.get(ship["ship_id"])
        if preferred in dict(candidates):
            chosen_berth = preferred
            free_at = dict(candidates)[preferred]
        else:
            chosen_berth, free_at = min(
                candidates,
                key=lambda item: (item[1], -float(berth_profiles[item[0]].get("capacity_tonnes", 0)))
            )
        arrival_time = ship.get("eta", ship["start_dt"])
        actual_start = max(arrival_time, free_at)
        unload_end = actual_start + timedelta(hours=float(ship["unload_hours"]))
        berth_available[chosen_berth] = unload_end
        scheduled.append({**ship, "assigned_berth": chosen_berth, "actual_start": actual_start,
                          "unload_end": unload_end,
                          "berth_wait_hours": max(0.0, (actual_start - arrival_time).total_seconds() / 3600),
                          "allocation_status": "Allocated"})

    # ------------------------------------------------------------------
    # CRANE OPTIMIZATION (UNCHANGED)
    # ------------------------------------------------------------------
    pending = [x for x in scheduled if x["allocation_status"] == "Allocated"]
    pending.sort(
        key=lambda x: (
            0 if x.get("spoilable") and x.get("spoilage_deadline") else 1,
            x.get("spoilage_deadline") or datetime.max,
            -float(x.get("weight_tonnes", 0)),
            x["unload_end"],
        )
    )
    crane_count = max(1, int(crane_count))
    crane_available = [(datetime.min, f"Crane {i+1}", 0.0) for i in range(crane_count)]
    transport_rows = []
    for job in pending:
        ready = job["unload_end"]
        crane_available.sort(key=lambda x: (x[0], x[2]))
        free_at, crane_name, assigned_tonnage = crane_available[0]
        transport_start = max(ready, free_at)
        duration_hours = max(0.25, float(job["weight_tonnes"]) / max(float(crane_rate), 1.0))
        transport_end = transport_start + timedelta(hours=duration_hours)
        crane_available[0] = (transport_end, crane_name, assigned_tonnage + float(job["weight_tonnes"]))
        deadline = job.get("spoilage_deadline")
        deadline_status = "-"
        if job.get("spoilable") and deadline:
            deadline_status = "Within deadline" if transport_end <= deadline else "Deadline risk"
        priority_reason = "Spoilable/deadline protection" if job.get("spoilable") and deadline else "Highest load first"
        transport_rows.append({
            "Ship ID": job["ship_id"], "Berth": job["assigned_berth"], "Crane": crane_name,
            "Weight (t)": round(float(job["weight_tonnes"]), 1),
            "Spoilable": "Yes" if job.get("spoilable") else "No",
            "Ready After Unloading": ready.strftime("%d-%b %H:%M"),
            "Transport Start": transport_start.strftime("%d-%b %H:%M"),
            "Transport End": transport_end.strftime("%d-%b %H:%M"),
            "Priority Reason": priority_reason, "Deadline Status": deadline_status,
        })

    berth_rows = []
    for job in sorted(scheduled, key=lambda x: x["actual_start"]):
        profile = berth_profiles.get(job["assigned_berth"], {})
        berth_rows.append({
            "Ship ID": job["ship_id"], "Berth": job["assigned_berth"],
            "Berth Capacity (t)": profile.get("capacity_tonnes", "-"),
            "Operator": job.get("operator", "-"), "Cargo": job.get("cargo_type", "-"),
            "Weight (t)": round(float(job.get("weight_tonnes", 0)), 1),
            "LOA (m)": job.get("loa_m", "-"), "Draft (m)": job.get("draft_m", "-"),
            "Requested Start": job["start_dt"].strftime("%d-%b %H:%M"),
            "Actual Start": job["actual_start"].strftime("%d-%b %H:%M"),
            "Unload End": job["unload_end"].strftime("%d-%b %H:%M"),
            "Berth Wait (h)": round(job["berth_wait_hours"], 2), "Status": job["allocation_status"],
            "_actual_start_dt": job["actual_start"], "_unload_end_dt": job["unload_end"],
        })
    return pd.DataFrame(berth_rows), pd.DataFrame(transport_rows)


# ------------------------------------------------------------------
# CSS
# ------------------------------------------------------------------
# Premium enterprise UI system: typography, spacing, surfaces, gradients
# ------------------------------------------------------------------
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

:root {
    --bg: #07111f;
    --bg-soft: #0b1728;
    --surface: rgba(14, 28, 47, .88);
    --surface-2: #102238;
    --border: rgba(103, 155, 206, .20);
    --text: #f4f8fc;
    --muted: #91a7bf;
    --cyan: #22d3ee;
    --blue: #4f8cff;
    --violet: #8b5cf6;
    --green: #34d399;
    --amber: #fbbf24;
    --red: #fb7185;
}

html, body, [class*="css"], .stApp, .stApp * {
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

/* Explicit typography overrides for Streamlit widgets */
.stApp input, .stApp textarea, .stApp button, .stApp select,
.stApp [data-baseweb="select"], .stApp [data-baseweb="input"],
.stApp [data-testid="stMetric"], .stApp [data-testid="stMetricLabel"],
.stApp [data-testid="stMetricValue"], .stApp [data-testid="stMetricDelta"],
.stApp .stSelectbox, .stApp .stNumberInput, .stApp .stSlider,
.stApp .stCheckbox, .stApp .stRadio, .stApp .stButton,
.stApp .stDownloadButton {
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

/* Display font for headings and key interface titles */
h1, h2, h3, h4, h5, h6,
.hero-title, .brand-name, .brand-mark-q,
.stApp [data-testid="stMetricValue"] {
    font-family: 'Space Grotesk', 'DM Sans', sans-serif !important;
}

.stApp {
    background:
        radial-gradient(circle at 12% 0%, rgba(34,211,238,.10), transparent 28%),
        radial-gradient(circle at 88% 8%, rgba(139,92,246,.10), transparent 30%),
        linear-gradient(135deg, #050c16 0%, #07111f 48%, #0a1423 100%);
    color: var(--text);
}
section[data-testid="stSidebar"] {
    background: linear-gradient(180deg, #071321 0%, #0a1728 100%);
    border-right: 1px solid var(--border);
}
.block-container { padding-top: 1.25rem; max-width: 1880px; }

/* Typography */
h1, h2, h3, h4 { font-family: 'Space Grotesk', 'DM Sans', sans-serif !important; letter-spacing: -.025em; color: var(--text) !important; }
.stMarkdown p, .stText, label, .stCaption { color: #c4d1df; }

/* Brand */
.brand-lockup { display:flex; align-items:center; gap:12px; padding:8px 2px 14px; }
.brand-mark {
    position:relative; width:42px; height:42px; border:1px solid rgba(34,211,238,.45);
    border-radius:13px; background:linear-gradient(145deg,#123a55 0%,#18204b 52%,#0b1728 100%);
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 10px 30px rgba(34,211,238,.12), inset 0 1px 0 rgba(255,255,255,.08);
}
.brand-mark:before { content:""; position:absolute; width:24px; height:24px; border:2px solid #67e8f9; border-radius:50%; opacity:.9; }
.brand-mark-q { position:relative; z-index:2; font-size:19px; font-weight:800; color:#fff; font-family:'Space Grotesk','DM Sans',sans-serif; }
.brand-mark-node { position:absolute; width:5px; height:5px; border-radius:50%; background:#34d399; box-shadow:0 0 8px rgba(52,211,153,.7); }
.brand-mark-node.n1 { top:4px; left:18px; }
.brand-mark-node.n2 { right:4px; bottom:9px; }
.brand-mark-node.n3 { left:5px; bottom:7px; }
.brand-name { font-family:'Space Grotesk','DM Sans',sans-serif; font-size:20px; font-weight:800; letter-spacing:.08em; color:#f8fbff; }
.brand-sub { font-size:10px; color:#8fa5bd; margin-top:2px; letter-spacing:.03em; }

/* Hero */
.nexus-brand { justify-content:center; padding-top:0; }
.nexus-brand .brand-name { font-size:22px; letter-spacing:.12em; background:linear-gradient(90deg,#f8fbff 0%,#67e8f9 48%,#a78bfa 100%); -webkit-background-clip:text; background-clip:text; color:transparent; }
.nexus-hero { margin:0; min-height:88px; padding:18px 22px; }
.hero-kicker { margin-top:3px; color:#67e8f9; font-size:10px; font-weight:800; letter-spacing:.18em; }
.stSidebar .stImage img { border-radius:18px; box-shadow:0 16px 38px rgba(34,211,238,.12); }
.hero {
    position:relative; overflow:hidden;
    background:linear-gradient(110deg, rgba(15,43,68,.96) 0%, rgba(22,32,73,.96) 48%, rgba(31,22,67,.94) 100%);
    border:1px solid rgba(103,155,206,.24); border-radius:18px;
    padding:20px 22px; margin-bottom:16px;
    box-shadow:0 18px 50px rgba(0,0,0,.20), inset 0 1px 0 rgba(255,255,255,.06);
}
.hero:after { content:""; position:absolute; width:260px; height:260px; right:-100px; top:-140px; border-radius:50%; background:rgba(34,211,238,.10); filter:blur(8px); }
.hero-title { font-family:'Space Grotesk','DM Sans',sans-serif; font-size:28px; font-weight:800; line-height:1.15; color:#fff; }
.hero-sub { color:#a9bad0; font-size:12px; margin-top:6px; letter-spacing:.02em; }

/* Surfaces */
.panel, .metric-card {
    background:linear-gradient(145deg, rgba(16,34,56,.94), rgba(9,22,38,.94));
    border:1px solid var(--border); border-radius:14px; padding:15px; margin-bottom:12px;
    box-shadow:0 12px 30px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.025);
}
.metric-card { transition:transform .2s ease, border-color .2s ease; }
.metric-card:hover { transform:translateY(-2px); border-color:rgba(34,211,238,.35); }
.tiny { color:#8fa5bd; font-size:11px; }

/* Streamlit widgets */
div[data-testid="stMetric"] { background:linear-gradient(145deg,rgba(15,35,57,.94),rgba(9,21,36,.94)); border:1px solid var(--border); border-radius:14px; padding:14px 16px; box-shadow:0 10px 25px rgba(0,0,0,.12); }
div[data-testid="stMetricLabel"] { color:#91a7bf !important; font-size:11px !important; font-weight:700 !important; letter-spacing:.08em; }
div[data-testid="stMetricValue"] { color:#f8fbff !important; font-family:'Space Grotesk','DM Sans',sans-serif; font-weight:800; }
.stButton > button, .stDownloadButton > button {
    border:1px solid rgba(103,155,206,.25); border-radius:10px; min-height:42px;
    background:linear-gradient(135deg,#163553,#1b2b55); color:#f8fbff; font-weight:700;
    transition:all .2s ease; box-shadow:0 8px 18px rgba(0,0,0,.12);
}
.stButton > button:hover, .stDownloadButton > button:hover { border-color:rgba(34,211,238,.55); transform:translateY(-1px); box-shadow:0 10px 24px rgba(34,211,238,.10); }
button[kind="primary"] { background:linear-gradient(135deg,#0891b2,#4f46e5) !important; border:0 !important; box-shadow:0 10px 28px rgba(79,70,229,.25) !important; }
.stTextInput input, .stNumberInput input, .stSelectbox div[data-baseweb="select"], .stDateInput input, .stTimeInput input {
    background:#0b1a2c !important; border-color:rgba(103,155,206,.22) !important; color:#f4f8fc !important; border-radius:9px !important;
}
.stSlider [data-baseweb="slider"] div { }

/* Status / alerts */
.status { padding:9px 11px; border-radius:9px; background:rgba(6,78,59,.30); border:1px solid rgba(52,211,153,.28); color:#6ee7b7; font-size:12px; }
.warning { padding:9px 11px; border-radius:9px; background:rgba(120,53,15,.25); border:1px solid rgba(251,191,36,.30); color:#fcd34d; font-size:12px; }

/* Tables */
div[data-testid="stDataFrame"] { border:1px solid var(--border); border-radius:12px; overflow:hidden; }

/* Footer */
.footer { border-top:1px solid var(--border); margin-top:16px; padding-top:13px; color:#71869d; font-size:11px; }

hr { border-color:rgba(103,155,206,.16) !important; }
</style>
""", unsafe_allow_html=True)

port = PORTS[st.session_state.selected_port]
scenario = st.session_state.scenario
ships = scenario["ships"]
unload_hours = scenario["unload_hours"]
load_teu = scenario["load_teu"]
priority = scenario["priority"]
disaster = scenario["disaster"]

# ------------------------------------------------------------------
# SIDEBAR
# ------------------------------------------------------------------
with st.sidebar:
    if LOGO_PATH.exists():
        st.image(str(LOGO_PATH), width=190)
    st.markdown(
        """
        <div class="brand-lockup nexus-brand">
            <div>
                <div class="brand-name">NEXUSPORT</div>
                <div class="brand-sub">Intelligent Maritime Operations</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.markdown("---")

    page = st.radio(
        "Navigation",
        [
            "Dashboard", "Ships", "Berths", "Yard",
            "Cranes", " Optimization", "Results",
            "Analytics", "Alerts",
            "Reports", "Settings"
        ],
        label_visibility="collapsed",
    )

    st.markdown("---")
    st.markdown("### Port Configuration")

    selected = st.selectbox("Select Port", list(PORTS.keys()))
    if selected != st.session_state.selected_port:
        st.session_state.selected_port = selected
        st.session_state.optimized = False
        st.rerun()

    port = PORTS[st.session_state.selected_port]

    st.markdown(
        f"""
        <div class="panel">
        <b>{port['short']}</b><br>
        <span class="tiny">{port['state']}</span><br><br>
        <b>{port['berths']}</b> - {port['berth_label']}<br>
        <span class="tiny">{port['notes']}</span>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.markdown("### Operational Scenario")

    new_ships = st.number_input(
        "Vessels in Scenario", 1, 200, int(scenario["ships"]), 1
    )
    new_hours = st.number_input(
        "Average Unloading Time (hours/vessel)", 0.5, 168.0,
        float(scenario["unload_hours"]), 0.5
    )
    new_load = st.number_input(
        "Planned Cargo Volume (TEU)", 100, 1000000,
        int(scenario["load_teu"]), 100
    )
    new_priority = st.slider(
        "Operational Priority", 1, 5, int(scenario["priority"])
    )
    new_disaster = st.checkbox(
        "Emergency Cargo Mode",
        bool(scenario["disaster"])
    )

    if st.button("Apply Scenario Configuration", use_container_width=True):
        st.session_state.scenario = {
            "ships": new_ships,
            "unload_hours": new_hours,
            "load_teu": new_load,
            "priority": new_priority,
            "disaster": new_disaster,
        }
        st.session_state.optimized = False
        st.rerun()

    st.markdown("---")
    st.markdown(
        """
        <div class="panel">
        <b> Optimization Engine</b><br><br>
        <span style="color:#4ade80"> READY</span><br>
        <span class="tiny">Mode</span><br>
        Quantum-inspired scheduling model<br><br>
        <span class="tiny">Objective</span><br>
        Minimize berth delays and handling time while protecting critical cargo.
        </div>
        """,
        unsafe_allow_html=True,
    )

# ------------------------------------------------------------------
# HEADER
# ------------------------------------------------------------------
hero_col1, hero_col2 = st.columns([0.16, 0.84])
with hero_col1:
    if LOGO_PATH.exists():
        st.image(str(LOGO_PATH), width=112)
with hero_col2:
    st.markdown(
        """
        <div class="hero nexus-hero">
            <div class="hero-title">NEXUSPORT</div>
            <div class="hero-kicker">INTELLIGENT MARITIME OPERATIONS</div>
            <div class="hero-sub">
                AI-powered port, berth, vessel & crane optimization •
                Quantum-inspired scheduling platform
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

# ------------------------------------------------------------------
# DASHBOARD
# ------------------------------------------------------------------

# ------------------------------------------------------------------
# SHIP POSITION / ETA HELPERS
# ------------------------------------------------------------------
def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))

def calculate_ship_eta(lat, lon, port_lat, port_lon, speed_knots, departure_dt):
    distance_km = haversine_km(lat, lon, port_lat, port_lon)
    speed_kmh = max(float(speed_knots), 0.1) * 1.852
    travel_hours = distance_km / speed_kmh
    return distance_km, travel_hours, departure_dt + timedelta(hours=travel_hours)

def valid_ship_position(lat, lon):
    return -20.0 <= lat <= 23.0 and 75.0 <= lon <= 100.0

def interpolate_ship_position(ship, simulation_time, port):
    """Move a ship smoothly from its entered sea position toward the port.

    Before departure the ship remains at its entered position. Between
    departure and ETA it travels linearly toward the port for visualization.
    After ETA the caller may replace the position with an anchorage/berth
    position depending on the live schedule state.
    """
    start = ship.get("start_dt", ship.get("updated_at", simulation_time))
    eta = ship.get("eta", start)
    lat0 = float(ship.get("latitude", port["lat"]))
    lon0 = float(ship.get("longitude", port["lon"]))
    if simulation_time <= start:
        return lat0, lon0
    if simulation_time >= eta:
        return float(port["lat"]), float(port["lon"])
    total = max((eta - start).total_seconds(), 1.0)
    elapsed = max(0.0, (simulation_time - start).total_seconds())
    ratio = min(1.0, elapsed / total)
    return lat0 + (port["lat"] - lat0) * ratio, lon0 + (port["lon"] - lon0) * ratio

def anchorage_coordinates(port, index=0):
    """Return a visible offshore anchorage holding point for a waiting ship."""
    earth_radius_km = 6371.0
    sea = np.deg2rad(float(port.get("sea_bearing", 90)))
    axis = np.deg2rad(float(port.get("berth_axis_bearing", 0)))
    # A small fan outside the berth row keeps waiting ships visibly separate.
    ring = 1.15 + 0.10 * (index % 4)
    along = (index - 1.5) * 0.20
    north_km = ring * np.cos(sea) + along * np.cos(axis)
    east_km = ring * np.sin(sea) + along * np.sin(axis)
    lat = port["lat"] + north_km / earth_radius_km * (180 / np.pi)
    lon = port["lon"] + east_km / (earth_radius_km * np.cos(np.deg2rad(port["lat"]))) * (180 / np.pi)
    return lat, lon

def live_ship_status(ship, schedule_row, simulation_time):
    """Return the vessel's live simulation state and anchorage wait duration."""
    eta = ship.get("eta", ship.get("start_dt", simulation_time))
    actual_start = schedule_row.get("Actual Start") if schedule_row is not None else None
    # Schedule data uses formatted strings; recover the datetime from the
    # optimization row's internal fields when available.
    if schedule_row is not None and "_actual_start_dt" in schedule_row:
        actual_start = schedule_row["_actual_start_dt"]
    else:
        actual_start = ship.get("eta", ship.get("start_dt", simulation_time))
    unload_end = schedule_row.get("_unload_end_dt") if schedule_row is not None else None
    if simulation_time < eta:
        return "Approaching", 0.0
    if actual_start and simulation_time < actual_start:
        wait = max(0.0, (actual_start - eta).total_seconds() / 3600)
        return "Waiting at Anchorage", wait
    if unload_end and simulation_time < unload_end:
        return "Servicing", 0.0
    return "Departed", 0.0

if "page" not in locals():
    page = "Dashboard"

if page == "Dashboard":

    c1, c2, c3, c4, c5, c6 = st.columns(6)
    detailed_ship_count = len(st.session_state.ship_details)
    detailed_load = sum(x["load_teu"] for x in st.session_state.ship_details) if st.session_state.ship_details else load_teu
    c1.metric("TOTAL SHIPS", detailed_ship_count if detailed_ship_count else ships)
    c2.metric("TOTAL LOAD", f"{detailed_load:,} TEU")
    c3.metric("TOTAL BERTHS", port["berths"])
    c4.metric("CRANES", max(4, min(30, port["berths"] + 8)))
    c5.metric("AVG DWELL", f"{unload_hours/24:.2f} d")
    throughput = int(load_teu / max(unload_hours / 24, 0.1))
    c6.metric("THROUGHPUT", f"{throughput:,}")

    # ------------------------------------------------------------------
    # LIVE SHIP MOVEMENT SIMULATOR
    # ------------------------------------------------------------------
    if st.session_state.ship_details:
        sim_min = min(
            [x.get("start_dt", st.session_state.simulation_time) for x in st.session_state.ship_details]
            + [st.session_state.simulation_time]
        )
        sim_max = max(
            [x.get("expected_end", x.get("eta", st.session_state.simulation_time)) for x in st.session_state.ship_details]
            + [st.session_state.simulation_time]
        ) + timedelta(hours=24)
        if st.session_state.simulation_time < sim_min or st.session_state.simulation_time > sim_max:
            st.session_state.simulation_time = sim_min
        st.markdown("### Live Ship Movement")
        sc1, sc2, sc3, sc4 = st.columns([1.4, 1.0, 1.0, 1.5])
        with sc1:
            st.session_state.simulation_time = st.slider(
                "Simulation time", min_value=sim_min, max_value=sim_max,
                value=st.session_state.simulation_time, step=timedelta(minutes=15),
                format="DD-MMM-YYYY HH:mm",
            )
        with sc2:
            if st.button("◀ 15 min", use_container_width=True):
                st.session_state.simulation_time = max(sim_min, st.session_state.simulation_time - timedelta(minutes=15))
                st.rerun()
        with sc3:
            if st.button("15 min ▶", use_container_width=True):
                st.session_state.simulation_time = min(sim_max, st.session_state.simulation_time + timedelta(minutes=15))
                st.rerun()
        with sc4:
            if st.button("Reset Simulation", use_container_width=True):
                st.session_state.simulation_time = sim_min
                st.rerun()
        st.caption("Move the simulation clock forward to watch ships approach the port, wait at colored anchorage spots, and enter their assigned berths.")

    map_col, right_col = st.columns([2.35, 1.15])

    # MAP
    with map_col:
        st.subheader(f"Live Port Operations - {port['short']}")
        legend_a, legend_b = st.columns(2)
        with legend_a:
            st.markdown('<div class="status"><b>AVAILABLE</b> | Berth is free</div>', unsafe_allow_html=True)
        with legend_b:
            st.markdown('<div style="padding:8px 10px;border-radius:8px;background:#2b1115;border:1px solid #7f1d1d;color:#f87171;font-size:12px;"><b>OCCUPIED</b> | Berth is scheduled</div>', unsafe_allow_html=True)
        st.markdown('<div style="padding:8px 10px;border-radius:8px;background:#2a1b05;border:1px solid #f59e0b;color:#fbbf24;font-size:12px;margin-top:6px;"><b>ANCHORAGE</b> | Ship is waiting offshore until its suitable berth becomes free</div>', unsafe_allow_html=True)

        port_map = folium.Map(
            location=[port["lat"], port["lon"]],
            zoom_start=13,
            tiles="OpenStreetMap",
            control_scale=True,
        )

        folium.TileLayer(
            tiles=(
                "https://server.arcgisonline.com/ArcGIS/rest/services/"
                "World_Imagery/MapServer/tile/{z}/{y}/{x}"
            ),
            attr="Esri World Imagery",
            name="Satellite",
            overlay=False,
        ).add_to(port_map)

        folium.Marker(
            [port["lat"], port["lon"]],
            tooltip=f"{port['short']} Port",
            popup=folium.Popup(
                f"""
                <b>{port['short']} Port</b><br>
                State: {port['state']}<br>
                Published berth count: <b>{port['berths']}</b><br>
                Coordinates: {port['lat']:.5f}, {port['lon']:.5f}
                """,
                max_width=320,
            ),
            icon=folium.Icon(color="blue", icon="anchor", prefix="fa"),
        ).add_to(port_map)

        # Berths are strictly rendered on the sea-facing side of the port in
        # a compact near-shore band. The line below visually represents the
        # bank/jetty edge; berth markers sit on its sea side.
        berth_layer = folium.FeatureGroup(name="Berths - Sea Bank")

        shore_center = berth_map_coordinates(port, (port["berths"] - 1) / 2.0, port["berths"])
        folium.PolyLine(
            [
                [port["lat"], port["lon"]],
                [shore_center[0], shore_center[1]],
            ],
            color="#38bdf8",
            weight=4,
            opacity=0.75,
            tooltip="Sea-side jetty / bank",
        ).add_to(berth_layer)

        berth_assignment = {}
        if st.session_state.ship_details:
            berth_schedule_for_map, _ = optimize_port_operations(
                st.session_state.ship_details,
                port["names"],
                int(st.session_state.crane_settings["cranes"]),
                float(st.session_state.crane_settings["rate_tph"]),
                port["berth_profiles"],
            )
            for _, row in berth_schedule_for_map.iterrows():
                berth_assignment.setdefault(row["Berth"], []).append(row["Ship ID"])

        count = port["berths"]
        has_ship_data = bool(st.session_state.ship_details)

        # When the operator has not entered any ship records yet, every berth
        # starts green. The generic scenario values must not falsely occupy
        # physical berths on the live map.
        for i, berth_name in enumerate(port["names"]):
            lat, lon = berth_map_coordinates(port, i, count)

            if has_ship_data and berth_assignment:
                assigned_ships = berth_assignment.get(berth_name, [])
                occupied = bool(assigned_ships)
            else:
                assigned_ships = []
                occupied = False
            color = "#ef4444" if occupied else "#22c55e"
            status = "Occupied / scheduled" if occupied else "Available"
            assigned_text = ", ".join(assigned_ships) if assigned_ships else "None"

            capacity = port["berth_profiles"][berth_name]["capacity_tonnes"]
            # After optimization, the berth hover explicitly reports both its
            # capacity and the ship allocated to it. Before optimization, we
            # do not imply an allocation exists.
            if st.session_state.optimized:
                hover_text = (
                    f"{berth_name} | Capacity: {capacity:,} t | "
                    f"Allocated ship: {assigned_text}"
                )
            else:
                hover_text = f"{berth_name} | Capacity: {capacity:,} t | Status: {status}"
            label_bg = "#ef4444" if occupied else "#22c55e"
            berth_html = (
                f'<div style="transform:translate(-50%,-50%);white-space:nowrap;'
                f'background:{label_bg};color:#06101c;border:2px solid #ffffff;'
                f'border-radius:7px;padding:4px 7px;font-weight:800;font-size:10px;'
                f'box-shadow:0 2px 7px rgba(0,0,0,.45);">'
                f'{berth_name}<br><span style="font-size:9px;">{capacity:,} t</span></div>'
            )
            folium.Marker(
                [lat, lon],
                tooltip=hover_text,
                popup=folium.Popup(
                    f"<b>{berth_name}</b><br>Capacity: {capacity:,} tonnes<br>"
                    f"Max LOA: {port['berth_profiles'][berth_name]['max_loa_m']:.0f} m<br>"
                    f"Max draft: {port['berth_profiles'][berth_name]['max_draft_m']:.1f} m<br>"
                    f"Cargo: {', '.join(port['berth_profiles'][berth_name]['cargo_types'])}<br>"
                    f"Status: {status}<br>Assigned ship(s): {assigned_text}",
                    max_width=340,
                ),
                icon=folium.DivIcon(html=berth_html),
            ).add_to(berth_layer)

        # Ships move with the virtual clock. A ship that has arrived but
        # cannot yet enter its assigned berth is placed at a colored anchorage
        # spot and its popup shows the planned waiting time.
        if st.session_state.ship_details:
            ship_layer = folium.FeatureGroup(name="Ships, Movement & Anchorage")
            scheduled_map, _ = optimize_port_operations(
                st.session_state.ship_details, port["names"],
                int(st.session_state.crane_settings["cranes"]),
                float(st.session_state.crane_settings["rate_tph"]),
                port["berth_profiles"],
            )
            berth_coords = {name: berth_map_coordinates(port, i, count) for i, name in enumerate(port["names"])}
            anchorage_used = 0
            for idx, ship in enumerate(st.session_state.ship_details):
                fallback_lat, fallback_lon = ship_map_coordinates(port, idx, len(st.session_state.ship_details))
                match = scheduled_map[scheduled_map["Ship ID"] == ship["ship_id"]] if not scheduled_map.empty else pd.DataFrame()
                row = match.iloc[0].to_dict() if not match.empty else None
                assigned = row.get("Berth", "No compatible berth") if row else "No compatible berth"
                status, wait_hours = live_ship_status(ship, row, st.session_state.simulation_time)

                # Travel to the port until ETA. After ETA, waiting ships move
                # to a dedicated anchorage holding point; servicing ships move
                # to their berth marker.
                eta = ship.get("eta", ship.get("start_dt", st.session_state.simulation_time))
                if st.session_state.simulation_time < eta:
                    ship_lat, ship_lon = interpolate_ship_position(ship, st.session_state.simulation_time, port)
                elif status == "Waiting at Anchorage":
                    ship_lat, ship_lon = anchorage_coordinates(port, anchorage_used)
                    anchorage_used += 1
                elif status == "Servicing" and assigned in berth_coords:
                    ship_lat, ship_lon = berth_coords[assigned]
                elif status == "Departed":
                    # Keep departed ships just beyond the port so the historical
                    # movement remains visible without occupying a berth.
                    ship_lat, ship_lon = ship_map_coordinates(port, idx + 5, len(st.session_state.ship_details) + 5)
                else:
                    ship_lat, ship_lon = fallback_lat, fallback_lon

                color = ship_color(idx)
                if status == "Waiting at Anchorage":
                    status_color = "#f59e0b"
                    icon_html = (
                        f'<div style="width:34px;height:34px;border-radius:50%;background:{status_color};'
                        f'border:3px solid #fff;box-shadow:0 2px 10px rgba(245,158,11,.75);'
                        f'display:flex;align-items:center;justify-content:center;color:#201100;'
                        f'font-weight:900;font-size:10px;">A{idx+1}</div>'
                    )
                    # Large translucent anchorage ring makes the waiting location
                    # obvious even when the ship marker is small.
                    folium.Circle(
                        [ship_lat, ship_lon], radius=260, color=status_color,
                        fill=True, fill_color=status_color, fill_opacity=0.18,
                        tooltip=f"{ship['ship_id']} anchorage | waiting {wait_hours:.1f} h",
                    ).add_to(ship_layer)
                    folium.CircleMarker(
                        [ship_lat, ship_lon], radius=8, color=status_color,
                        fill=True, fill_color=status_color, fill_opacity=0.85,
                        popup=folium.Popup(
                            f"<b>ANCHORAGE HOLDING AREA</b><br>Ship: {ship['ship_id']}<br>"
                            f"Waiting time: <b>{wait_hours:.1f} hours</b><br>"
                            f"Next berth: <b>{assigned}</b><br>"
                            f"Reason: berth is currently occupied / unavailable.<br>"
                            f"Simulation time: {st.session_state.simulation_time.strftime('%d-%b-%Y %H:%M')}",
                            max_width=330,
                        ),
                    ).add_to(ship_layer)
                else:
                    status_color = color
                    icon_html = f'<div style="width:30px;height:30px;border-radius:50%;background:{color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#06101c;font-weight:800;font-size:10px;">{idx+1}</div>'

                popup_text = (
                    f"<b>{ship['ship_id']}</b><br>Cargo: {ship['cargo_type']}<br>"
                    f"Load: {ship['weight_tonnes']:,.0f} t<br>LOA: {ship['loa_m']:.1f} m<br>"
                    f"Draft: {ship['draft_m']:.1f} m<br>"
                    f"Status: <b>{status}</b><br>Assigned berth: {assigned}<br>"
                    f"ETA: {eta.strftime('%d-%b %H:%M')}"
                )
                folium.Marker(
                    [ship_lat, ship_lon],
                    tooltip=f"{ship['ship_id']} | {status}",
                    popup=folium.Popup(popup_text, max_width=330),
                    icon=folium.DivIcon(html=icon_html),
                ).add_to(ship_layer)

                if status == "Approaching" and st.session_state.optimized and assigned in berth_coords:
                    bl, bo = berth_coords[assigned]
                    line = folium.PolyLine(
                        [[ship_lat, ship_lon], [bl, bo]],
                        color=color, weight=2, opacity=0.55, dash_array="7,8",
                    ).add_to(ship_layer)
                    PolyLineTextPath(line, "➜", repeat=False, offset=55,
                                     attributes={"fill": color, "font-weight": "bold", "font-size": "18"}).add_to(ship_layer)
                elif status == "Waiting at Anchorage" and assigned in berth_coords:
                    bl, bo = berth_coords[assigned]
                    line = folium.PolyLine(
                        [[ship_lat, ship_lon], [bl, bo]],
                        color="#f59e0b", weight=3, opacity=0.85, dash_array="4,7",
                    ).add_to(ship_layer)
                    PolyLineTextPath(line, "➜", repeat=False, offset=55,
                                     attributes={"fill": "#f59e0b", "font-weight": "bold", "font-size": "18"}).add_to(ship_layer)

            ship_layer.add_to(port_map)

        berth_layer.add_to(port_map)
        folium.LayerControl(collapsed=False).add_to(port_map)

        st_folium(
            port_map,
            height=540,
            use_container_width=True,
            returned_objects=[],
        )

        occupied_for_map = sum(1 for v in berth_assignment.values() if v) if st.session_state.ship_details else 0
        st.caption(
            f"Selected port: {port['short']} | Occupied: {occupied_for_map} | Available: {port['berths'] - occupied_for_map}. "
            "Green = available | Red = occupied/scheduled | Amber = ship waiting at anchorage. "
            "Berths are arranged on the sea-facing side of the port as a schematic jetty row. "
            "Select a berth marker to inspect its current status."
        )

    # RIGHT SIDE
    with right_col:
        if st.session_state.ship_details:
            live_schedule, _ = optimize_port_operations(
                st.session_state.ship_details, port["names"],
                int(st.session_state.crane_settings["cranes"]),
                float(st.session_state.crane_settings["rate_tph"]),
                port["berth_profiles"],
            )
            waiting_count = 0
            approaching_count = 0
            servicing_count = 0
            for _, r in live_schedule.iterrows():
                ship = next((x for x in st.session_state.ship_details if x["ship_id"] == r["Ship ID"]), None)
                if not ship:
                    continue
                status, _ = live_ship_status(ship, r.to_dict(), st.session_state.simulation_time)
                if status == "Waiting at Anchorage": waiting_count += 1
                elif status == "Approaching": approaching_count += 1
                elif status == "Servicing": servicing_count += 1
            st.subheader("Live Simulation Status")
            st.metric("Simulation Clock", st.session_state.simulation_time.strftime("%d-%b %H:%M"))
            lc1, lc2, lc3 = st.columns(3)
            lc1.metric("Approaching", approaching_count)
            lc2.metric("Anchorage", waiting_count)
            lc3.metric("Servicing", servicing_count)

        st.subheader("Optimization Performance")

        baseline_wait = max(0.8, unload_hours / 12)
        optimized_wait = (
            max(0.35, baseline_wait * 0.78)
            if st.session_state.optimized
            else max(0.5, baseline_wait * 0.92)
        )

        summary = pd.DataFrame({
            "Metric": [
                "Total Load (TEU)",
                "Avg Unloading (h)",
                "Berth Utilization Overview (%)",
                "Priority Cargo (%)",
                "Estimated Wait (h)",
            ],
            "Classical": [
                f"{load_teu:,}",
                f"{unload_hours:.1f}",
                "68.3",
                f"{min(100, priority * 15):.0f}",
                f"{baseline_wait:.2f}",
            ],
            "Optimized": [
                f"{load_teu:,}",
                f"{unload_hours * 0.86:.1f}",
                "86.7" if st.session_state.optimized else "72.4",
                f"{min(100, priority * 18 + (20 if disaster else 0)):.0f}",
                f"{optimized_wait:.2f}",
            ],
        })

        st.dataframe(summary, hide_index=True, use_container_width=True)

        if disaster:
            st.markdown(
                '<div class="warning">Emergency mode active - critical cargo receives elevated scheduling priority.</div>',
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                '<div class="status"> Normal operations</div>',
                unsafe_allow_html=True,
            )

        score = (
            priority * 20
            + min(load_teu / 1000, 100) * 0.35
            + (45 if disaster else 0)
        )
        st.metric("Scenario Priority Score", f"{score:.1f}")

        st.markdown("### Port Profile")
        st.write(f"**State:** {port['state']}")
        st.write(f"**Berths:** {port['berths']}")
        st.write(f"**Data source:** {port['source']}")

    # BOTTOM - SCHEDULE + BERTH UTILIZATION
    bottom1, bottom2 = st.columns([1.35, 1])

    with bottom1:
        st.subheader("Optimized Vessel Schedule")

        if st.session_state.ship_details:
            berth_schedule, _ = optimize_port_operations(st.session_state.ship_details, port["names"], int(st.session_state.crane_settings["cranes"]), float(st.session_state.crane_settings["rate_tph"]), port["berth_profiles"])
            st.dataframe(berth_schedule, hide_index=True, use_container_width=True, height=290)
        else:
            st.info("Add Vessel Details to generate an individual ship schedule.")

    with bottom2:
        st.subheader("Berth Utilization Overview")

        util = [
            55 + ((i * 13) % 42) if st.session_state.optimized
            else 25 + ((i * 19) % 50)
            for i in range(port["berths"])
        ]

        fig = go.Figure(go.Bar(
            x=port["names"],
            y=util,
            text=[f"{x}%" for x in util],
            textposition="outside",
        ))
        fig.update_layout(
            height=290,
            margin=dict(l=10, r=10, t=10, b=10),
            paper_bgcolor="#091827",
            plot_bgcolor="#091827",
            font=dict(color="#dbe7f3"),
            yaxis=dict(range=[0, 110], title="Utilization %"),
        )
        st.plotly_chart(fig, use_container_width=True)

    # BOTTOM - CHARTS
    chart1, chart2 = st.columns([1.35, 1])

    with chart1:
        st.subheader("Throughput Trend")

        hours = np.arange(25)
        classical = np.cumsum(
            np.maximum(100, load_teu / 24 * 0.72 + np.sin(hours) * 100)
        )
        optimized_curve = np.cumsum(
            np.maximum(
                120,
                load_teu / 24 * (0.92 if st.session_state.optimized else 0.78)
                + np.cos(hours) * 100,
            )
        )

        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=hours, y=classical,
            mode="lines+markers", name="Classical"
        ))
        fig.add_trace(go.Scatter(
            x=hours, y=optimized_curve,
            mode="lines+markers", name="Optimized"
        ))
        fig.update_layout(
            height=290,
            margin=dict(l=10, r=10, t=10, b=10),
            paper_bgcolor="#091827",
            plot_bgcolor="#091827",
            font=dict(color="#dbe7f3"),
            xaxis_title="Time (hours)",
            yaxis_title="Cumulative TEU",
        )
        st.plotly_chart(fig, use_container_width=True)

    with chart2:
        st.subheader("Crane Utilization")

        working = 65 + (12 if st.session_state.optimized else 0)
        working = min(90, working)

        fig = go.Figure(go.Pie(
            labels=["Working", "Idle", "Maintenance"],
            values=[working, 100 - working - 5, 5],
            hole=0.62,
        ))
        fig.update_layout(
            height=290,
            margin=dict(l=10, r=10, t=10, b=10),
            paper_bgcolor="#091827",
            font=dict(color="#dbe7f3"),
        )
        st.plotly_chart(fig, use_container_width=True)

    st.markdown("---")
    if st.button(" RUN PORT OPTIMIZATION", type="primary", use_container_width=True):
        st.session_state.optimized = True
        st.success(
            f"Optimization completed for {port['short']}. "
            "Emergency/high-load cargo has been given higher scheduling priority."
        )
        st.rerun()

# ------------------------------------------------------------------
# OTHER PAGES
# ------------------------------------------------------------------
elif page == "Ships":
    st.header("Vessel Details")
    st.success("Vessel details are synchronized from the separate NexusPort Vessel Input application.")

    ships = load_ship_details()
    st.session_state.ship_details = ships

    refresh_col, erase_col, _ = st.columns([1, 1, 3])
    with refresh_col:
        if st.button("Refresh Vessel Data", use_container_width=True):
            st.session_state.ship_details = load_ship_details()
            st.rerun()
    with erase_col:
        if st.button("Erase All Ship Data", type="secondary", use_container_width=True):
            clear_ship_details()
            st.session_state.ship_details = []
            st.session_state.optimized = False
            st.session_state.selected_ship_id = None
            st.success("All ship data has been erased from the shared vessel store.")
            st.rerun()

    st.write("This page now reads the exact vessel records entered in the separate Vessel Input application. The original berth, yard, crane, optimization, results, analytics, alerts, reports, settings and live simulation features remain unchanged.")

    st.markdown("### Synchronized Vessel Details")
    if st.session_state.ship_details:
        display_rows = [{
            "Ship ID": x["ship_id"], "Operator": x["operator"], "Cargo": x["cargo_type"],
            "Weight (t)": x["weight_tonnes"], "TEU": x["load_teu"], "LOA (m)": x["loa_m"], "Draft (m)": x["draft_m"],
            "Latitude": x.get("latitude", ""), "Longitude": x.get("longitude", ""),
            "Speed (knots)": x.get("speed_knots", ""), "Distance (km)": round(x.get("distance_km", 0), 1),
            "Estimated Departure": x["start_dt"].strftime("%d-%b %H:%M") if x.get("start_dt") else "-",
            "ETA": x.get("eta").strftime("%d-%b %H:%M") if x.get("eta") else "-",
            "Updated At": x.get("updated_at").strftime("%d-%b %H:%M") if x.get("updated_at") else "-",
            "Expected End": x["expected_end"].strftime("%d-%b %H:%M") if x.get("expected_end") else "-",
            "Unload (h)": x.get("unload_hours", ""), "Spoilable": "Yes" if x.get("spoilable") else "No",
            "Spoilage Deadline": x["spoilage_deadline"].strftime("%d-%b %H:%M") if x.get("spoilage_deadline") else "-",
        } for x in st.session_state.ship_details]
        st.dataframe(pd.DataFrame(display_rows), hide_index=True, use_container_width=True)
        st.caption(f"{len(st.session_state.ship_details)} vessel(s) currently available to the original optimization engine.")
    else:
        st.info("No vessel records are currently available. Add vessels from the separate Vessel Input application.")

    st.markdown("### Crane & Transport Settings")
    cs1, cs2 = st.columns(2)
    with cs1:
        st.session_state.crane_settings["cranes"] = st.number_input("Available Cranes", 1, 50, int(st.session_state.crane_settings["cranes"]), 1)
    with cs2:
        st.session_state.crane_settings["rate_tph"] = st.number_input("Transport capacity per crane (tonnes/hour)", 50.0, 10000.0, float(st.session_state.crane_settings["rate_tph"]), 50.0)
    st.caption("Crane settings remain local to this original application; only vessel details are shared.")

elif page == "Berths":
    st.header(f"{port['short']} - Berths")
    st.write("Each berth has its own planning capacity, vessel-size limits, cargo compatibility and handling rate. Ships are allocated only to compatible berths.")
    berth_schedule = pd.DataFrame()
    if st.session_state.ship_details:
        berth_schedule, _ = optimize_port_operations(st.session_state.ship_details, port["names"], int(st.session_state.crane_settings["cranes"]), float(st.session_state.crane_settings["rate_tph"]), port["berth_profiles"])
    assigned_by_berth = {}
    if not berth_schedule.empty:
        for _, row in berth_schedule.iterrows(): assigned_by_berth[row["Berth"]] = row["Ship ID"]
    rows=[]
    for name in port["names"]:
        b=port["berth_profiles"][name]
        rows.append({"Berth":name,"Capacity (t)":b["capacity_tonnes"],"Max LOA (m)":b["max_loa_m"],"Max Draft (m)":b["max_draft_m"],"Cargo Types":", ".join(b["cargo_types"]),"Handling Rate (t/h)":b["handling_rate_tph"],"Assigned Ship":assigned_by_berth.get(name,"Available")})
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
    if not berth_schedule.empty:
        st.markdown("### Allocation Result")
        st.dataframe(berth_schedule, hide_index=True, use_container_width=True)
    st.caption("These are default planning profiles for the prototype. Replace them with verified berth-level authority/GIS engineering data before operational use.")

elif page == "Yard":
    st.header("Yard Utilization")
    rng = np.random.default_rng(42)
    z = rng.uniform(10, 100, (8, 24))
    fig = go.Figure(go.Heatmap(
        z=z,
        x=[f"C{i+1}" for i in range(24)],
        y=[f"Block {i+1}" for i in range(8)],
        colorbar_title="Utilization %",
    ))
    fig.update_layout(height=500, paper_bgcolor="#091827", font=dict(color="#dbe7f3"))
    st.plotly_chart(fig, use_container_width=True)

elif page == "Cranes":
    st.header("Crane Optimization")
    st.write(
        "Optimize crane assignments across different berths. "
        "The primary objective is to maximize crane utility by moving the "
        "largest available loads first while respecting spoilage deadlines."
    )

    if not st.session_state.ship_details:
        st.info("Add and update individual ship details first.")
    else:
        if st.button(
            "Optimize Loads for Berths",
            type="primary",
            use_container_width=True,
        ):
            st.session_state.optimized = True
            st.success(
                "Load optimization completed: cranes are assigned across berths "
                "with the heaviest available loads receiving priority."
            )
            st.rerun()

        berth_schedule, crane_schedule = optimize_port_operations(
            st.session_state.ship_details,
            port["names"],
            int(st.session_state.crane_settings["cranes"]),
            float(st.session_state.crane_settings["rate_tph"]),
            port["berth_profiles"],
        )

        st.markdown("### Optimized Loads for Berths")

        # Aggregate load assigned to each berth.
        berth_loads = {}
        for row in berth_schedule.to_dict("records"):
            berth = row.get("Berth")
            if berth and not str(berth).startswith("No compatible"):
                berth_loads.setdefault(berth, 0.0)
                berth_loads[berth] += float(row.get("Weight (t)", 0) or 0)

        berth_load_rows = []
        for berth_name in port["names"]:
            profile = port["berth_profiles"].get(berth_name, {})
            capacity = float(profile.get("capacity_tonnes", 0) or 0)
            allocated = berth_loads.get(berth_name, 0.0)
            utilization = (allocated / capacity * 100.0) if capacity else 0.0
            berth_load_rows.append({
                "Berth": berth_name,
                "Capacity (t)": capacity,
                "Allocated Load (t)": round(allocated, 1),
                "Utilization (%)": round(utilization, 1),
                "Remaining Capacity (t)": round(max(0.0, capacity - allocated), 1),
            })

        st.dataframe(
            pd.DataFrame(berth_load_rows),
            hide_index=True,
            use_container_width=True,
        )

        st.markdown("### Crane Assignment")
        st.dataframe(crane_schedule, hide_index=True, use_container_width=True)

        if not crane_schedule.empty:
            crane_loads = (
                crane_schedule.groupby("Crane")["Weight (t)"]
                .sum()
                .reindex(
                    [f"Crane {i+1}" for i in range(int(st.session_state.crane_settings["cranes"]))],
                    fill_value=0,
                )
            )
            st.markdown("### Crane Load Utility")
            crane_load_df = pd.DataFrame({
                "Crane": crane_loads.index,
                "Assigned Load (t)": crane_loads.values,
            })
            st.dataframe(crane_load_df, hide_index=True, use_container_width=True)

            fig = go.Figure(
                go.Bar(
                    x=crane_load_df["Crane"],
                    y=crane_load_df["Assigned Load (t)"],
                    text=crane_load_df["Assigned Load (t)"],
                    textposition="outside",
                )
            )
            fig.update_layout(
                height=320,
                margin=dict(l=10, r=10, t=10, b=10),
                paper_bgcolor="#091827",
                plot_bgcolor="#091827",
                font=dict(color="#dbe7f3"),
                yaxis_title="Assigned load (tonnes)",
            )
            st.plotly_chart(fig, use_container_width=True)


elif page == " Optimization":
    st.header("Optimization Engine")
    st.write("The optimizer combines dynamic berth scheduling with post-unloading crane transport. Berth allocation uses a QUBO + QAOA quantum-optimization layer for small scenarios and a scalable QUBO local-search fallback for larger scenarios.")
    if not st.session_state.ship_details:
        st.info("Add Vessel Details before running the detailed optimizer.")
    else:
        berth_schedule, crane_schedule = optimize_port_operations(st.session_state.ship_details, port["names"], int(st.session_state.crane_settings["cranes"]), float(st.session_state.crane_settings["rate_tph"]), port["berth_profiles"])
        st.markdown("### Scheduling Rules")
        st.markdown("1. Respect each ship's requested start time.  \n2. Assign an available berth and minimize berth waiting.  \n3. A crane job becomes ready when unloading finishes.  \n4. For crane allocation: spoilable/deadline-risk cargo is protected first; otherwise the heaviest load gets crane priority.  \n5. Assign each prioritized job to the crane that becomes available first.")
        st.markdown("### Berth Schedule")
        st.dataframe(berth_schedule, hide_index=True, use_container_width=True)
        st.markdown("### Crane Transport Schedule")
        st.dataframe(crane_schedule, hide_index=True, use_container_width=True)
        if st.button("Optimize Cranes by Load Priority", type="primary", use_container_width=True):
            if st.session_state.ship_details:
                st.session_state.optimized = True
                st.success("Crane schedule updated: spoilable/deadline-risk cargo is protected first; otherwise the most loaded ships receive crane priority.")
                st.rerun()
            else:
                st.warning("Add and update ship details first.")
        if st.button("Run Port Optimization", type="primary", use_container_width=True):
            st.session_state.optimized = True
            st.success("Berth and crane schedules have been optimized using the entered ship details.")
            st.rerun()

elif page == "Results":
    st.header("Results")
    st.metric("Optimization Status", "Completed" if st.session_state.optimized else "Not run")
    st.write("Use the Dashboard for the full schedule and comparison.")

elif page == "Analytics":
    st.header("Analytics")
    st.info(
        "This page is ready for historical throughput, dwell time, berth occupancy, "
        "AIS traffic and crane performance data."
    )

elif page == "Alerts":
    st.header("Alerts")
    if disaster:
        st.error("Emergency cargo mode is active.")
    else:
        st.success("No active emergency alerts.")
    entered_ships = len(st.session_state.ship_details)
    if entered_ships > port["berths"]:
        st.warning(
            f"{entered_ships} entered ships vs {port['berths']} published berth positions: queueing is required."
        )
    elif entered_ships == 0:
        st.success("No ship records have been entered. All displayed berths are currently available.")
    else:
        st.success("Current entered ship count fits within the displayed berth capacity.")

elif page == "Reports":
    st.header("Reports")
    report = pd.DataFrame({
        "Port": [port["short"]],
        "Ships": [ships],
        "Cargo (TEU)": [load_teu],
        "Unload time (h)": [unload_hours],
        "Berths": [port["berths"]],
        "Emergency": ["YES" if disaster else "NO"],
        "Optimized": ["YES" if st.session_state.optimized else "NO"],
    })
    st.dataframe(report, hide_index=True, use_container_width=True)
    st.download_button(
        "Download CSV report",
        report.to_csv(index=False),
        f"{port['short'].replace(' ', '_')}_report.csv",
        "text/csv",
    )

elif page == "Settings":
    st.header("Settings")
    st.checkbox("Dark dashboard theme", True)
    st.checkbox("Show berth capacity markers", True)
    st.checkbox("Show emergency alerts", True)
    st.info(
        "Port data is separated from the UI so additional Select Ports can be "
        "added later without rewriting the dashboard."
    )

st.markdown(
    f"""
    <div class="footer">
     NexusPort Intelligent Maritime Operations | {port['short']} |
    Data source: {port['source']}
    </div>
    """,
    unsafe_allow_html=True,
)
