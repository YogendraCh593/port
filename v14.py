
import streamlit as st
import pandas as pd
import numpy as np
import math
import plotly.graph_objects as go
import folium
from folium.plugins import PolyLineTextPath
from streamlit_folium import st_folium
from datetime import datetime, timedelta, time

st.set_page_config(
    page_title="Quantum Port Optimization",
    page_icon="Q",
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

# ------------------------------------------------------------------
# SHIP AND CRANE OPTIMIZATION STATE
# ------------------------------------------------------------------
if "ship_details" not in st.session_state:
    st.session_state.ship_details = []

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

def optimize_port_operations(ship_details, berth_names, crane_count, crane_rate, berth_profiles=None):
    if not ship_details:
        return pd.DataFrame(), pd.DataFrame()
    berth_profiles = berth_profiles or {}
    berth_available = {name: datetime.min for name in berth_names}
    scheduled = []
    ships_sorted = sorted(ship_details, key=lambda x: (x["start_dt"], -float(x.get("weight_tonnes", 0))))
    for ship in ships_sorted:
        candidates = []
        for name in berth_names:
            profile = berth_profiles.get(name, {})
            if berth_compatibility(ship, profile):
                candidates.append((name, berth_available[name]))
        if not candidates:
            scheduled.append({**ship, "assigned_berth": "No compatible berth", "actual_start": ship["start_dt"],
                              "unload_end": ship["start_dt"], "berth_wait_hours": 0.0,
                              "allocation_status": "Rejected: no compatible berth"})
            continue
        chosen_berth, free_at = min(candidates, key=lambda item: (item[1], -float(berth_profiles[item[0]].get("capacity_tonnes", 0))))
        actual_start = max(ship["start_dt"], free_at)
        unload_end = actual_start + timedelta(hours=float(ship["unload_hours"]))
        berth_available[chosen_berth] = unload_end
        scheduled.append({**ship, "assigned_berth": chosen_berth, "actual_start": actual_start,
                          "unload_end": unload_end,
                          "berth_wait_hours": max(0.0, (actual_start - ship["start_dt"]).total_seconds() / 3600),
                          "allocation_status": "Allocated"})
    # ------------------------------------------------------------------
    # CRANE OPTIMIZATION
    # Primary objective: maximize crane utility by prioritizing the largest
    # loads across different berths. Spoilable cargo remains protected when
    # it has a deadline risk.
    # ------------------------------------------------------------------
    pending = [x for x in scheduled if x["allocation_status"] == "Allocated"]

    # Highest-load jobs are considered first. Spoilable jobs with an active
    # deadline are promoted so the load-priority objective does not create
    # avoidable spoilage.
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

        # Pick the crane that becomes available first; if multiple cranes are
        # available at the same time, prefer the one with the least assigned
        # tonnage. This balances utility while still processing the heaviest
        # available loads first.
        crane_available.sort(key=lambda x: (x[0], x[2]))
        free_at, crane_name, assigned_tonnage = crane_available[0]

        transport_start = max(ready, free_at)
        duration_hours = max(
            0.25,
            float(job["weight_tonnes"]) / max(float(crane_rate), 1.0)
        )
        transport_end = transport_start + timedelta(hours=duration_hours)

        new_tonnage = assigned_tonnage + float(job["weight_tonnes"])
        crane_available[0] = (transport_end, crane_name, new_tonnage)

        deadline = job.get("spoilage_deadline")
        deadline_status = "-"
        if job.get("spoilable") and deadline:
            deadline_status = (
                "Within deadline" if transport_end <= deadline else "Deadline risk"
            )

        if job.get("spoilable") and deadline:
            priority_reason = "Spoilable/deadline protection"
        else:
            priority_reason = "Highest load first"

        transport_rows.append({
            "Ship ID": job["ship_id"],
            "Berth": job["assigned_berth"],
            "Crane": crane_name,
            "Weight (t)": round(float(job["weight_tonnes"]), 1),
            "Spoilable": "Yes" if job.get("spoilable") else "No",
            "Ready After Unloading": ready.strftime("%d-%b %H:%M"),
            "Transport Start": transport_start.strftime("%d-%b %H:%M"),
            "Transport End": transport_end.strftime("%d-%b %H:%M"),
            "Priority Reason": priority_reason,
            "Deadline Status": deadline_status,
        })

        berth_rows=[]
    for job in sorted(scheduled,key=lambda x:x["actual_start"]):
        profile=berth_profiles.get(job["assigned_berth"],{})
        berth_rows.append({"Ship ID":job["ship_id"],"Berth":job["assigned_berth"],"Berth Capacity (t)":profile.get("capacity_tonnes","-"),
                           "Operator":job.get("operator","-"),"Cargo":job.get("cargo_type","-"),"Weight (t)":round(float(job.get("weight_tonnes",0)),1),
                           "LOA (m)":job.get("loa_m","-"),"Draft (m)":job.get("draft_m","-"),
                           "Requested Start":job["start_dt"].strftime("%d-%b %H:%M"),"Actual Start":job["actual_start"].strftime("%d-%b %H:%M"),
                           "Unload End":job["unload_end"].strftime("%d-%b %H:%M"),"Berth Wait (h)":round(job["berth_wait_hours"],2),"Status":job["allocation_status"]})
    return pd.DataFrame(berth_rows), pd.DataFrame(transport_rows)


# ------------------------------------------------------------------
# CSS
# ------------------------------------------------------------------
st.markdown("""
<style>
.stApp { background:#06101c; color:#e7eef7; }
section[data-testid="stSidebar"] { background:#071525; border-right:1px solid #18304a; }
.block-container { padding-top:1rem; max-width:1800px; }
.hero {
    background:linear-gradient(90deg,#0b1b2c,#081522);
    border:1px solid #18304a; border-radius:14px;
    padding:15px 18px; margin-bottom:12px;
}

.brand-lockup {
    display:flex; align-items:center; gap:10px; padding:4px 0 8px;
}
.brand-mark {
    position:relative; width:38px; height:38px; border:1px solid #2b6ea6;
    border-radius:11px; background:linear-gradient(145deg,#0d2b45,#081522);
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 6px 18px rgba(0,0,0,.25);
}
.brand-mark:before {
    content:""; position:absolute; width:22px; height:22px; border:2px solid #58a6ff;
    border-radius:50%; opacity:.85;
}
.brand-mark-q { position:relative; z-index:2; font-size:19px; font-weight:800; color:#e7eef7; }
.brand-mark-node { position:absolute; width:4px; height:4px; border-radius:50%; background:#4ade80; }
.brand-mark-node.n1 { top:4px; left:17px; }
.brand-mark-node.n2 { right:4px; bottom:9px; }
.brand-mark-node.n3 { left:5px; bottom:7px; }
.brand-name { font-size:20px; font-weight:800; letter-spacing:.08em; color:#e7eef7; }
.brand-sub { font-size:10px; color:#8fa5bd; margin-top:1px; }

.hero-title { font-size:26px; font-weight:750; }
.hero-sub { color:#8fa5bd; font-size:13px; margin-top:3px; }
.panel {
    background:#091827; border:1px solid #19324a;
    border-radius:12px; padding:14px; margin-bottom:12px;
}
.metric-card {
    background:#091827; border:1px solid #19324a;
    border-radius:11px; padding:12px;
}
.tiny { color:#8fa5bd; font-size:11px; }
.status {
    padding:8px 10px; border-radius:8px;
    background:#082315; border:1px solid #14532d;
    color:#4ade80; font-size:12px;
}
.warning {
    padding:8px 10px; border-radius:8px;
    background:#2a1d08; border:1px solid #854d0e;
    color:#fbbf24; font-size:12px;
}
.footer {
    border-top:1px solid #18304a; margin-top:12px;
    padding-top:12px; color:#7890aa; font-size:11px;
}
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
    st.markdown(
        """
        <div class="brand-lockup">
            <div class="brand-mark">
                <span class="brand-mark-q">Q</span>
                <span class="brand-mark-node n1"></span>
                <span class="brand-mark-node n2"></span>
                <span class="brand-mark-node n3"></span>
            </div>
            <div>
                <div class="brand-name">QAIC</div>
                <div class="brand-sub">Quantum & AI Innovation Centre</div>
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
    st.markdown("### Port Selection")

    selected = st.selectbox("Indian port", list(PORTS.keys()))
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

    st.markdown("### Scenario Inputs")

    new_ships = st.number_input(
        "Number of ships", 1, 200, int(scenario["ships"]), 1
    )
    new_hours = st.number_input(
        "Unloading time (hours/ship)", 0.5, 168.0,
        float(scenario["unload_hours"]), 0.5
    )
    new_load = st.number_input(
        "Load to unload (TEU)", 100, 1000000,
        int(scenario["load_teu"]), 100
    )
    new_priority = st.slider(
        "Operational priority", 1, 5, int(scenario["priority"])
    )
    new_disaster = st.checkbox(
        "Disaster / emergency cargo",
        bool(scenario["disaster"])
    )

    if st.button("Apply Scenario", use_container_width=True):
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
        Quantum-inspired scheduling demo<br><br>
        <span class="tiny">Objective</span><br>
        Reduce berth waiting and unloading time while prioritizing critical cargo.
        </div>
        """,
        unsafe_allow_html=True,
    )

# ------------------------------------------------------------------
# HEADER
# ------------------------------------------------------------------
st.markdown(
    """
    <div class="hero">
        <div style="display:flex;align-items:center;gap:12px;">
            <div class="brand-mark" style="flex:0 0 auto;">
                <span class="brand-mark-q">Q</span>
                <span class="brand-mark-node n1"></span>
                <span class="brand-mark-node n2"></span>
                <span class="brand-mark-node n3"></span>
            </div>
            <div class="hero-title">
                Quantum Optimization for Port & Container Terminal Operations
            </div>
        </div>
        <div class="hero-sub">
            UC-039 | Port and Container Terminal Optimization |
            Quantum-inspired Powered Scheduler
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

    map_col, right_col = st.columns([2.35, 1.15])

    # MAP
    with map_col:
        st.subheader(f"Live Port Operations - {port['short']}")
        legend_a, legend_b = st.columns(2)
        with legend_a:
            st.markdown('<div class="status"><b>AVAILABLE</b> | Berth is free</div>', unsafe_allow_html=True)
        with legend_b:
            st.markdown('<div style="padding:8px 10px;border-radius:8px;background:#2b1115;border:1px solid #7f1d1d;color:#f87171;font-size:12px;"><b>OCCUPIED</b> | Berth is scheduled</div>', unsafe_allow_html=True)

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

        # Ships are shown offshore with unique colors. After optimization, a
        # directional arrow joins each ship to its allocated berth.
        if st.session_state.ship_details:
            ship_layer = folium.FeatureGroup(name="Ships and Assignments")
            scheduled_map, _ = optimize_port_operations(st.session_state.ship_details, port["names"],
                int(st.session_state.crane_settings["cranes"]), float(st.session_state.crane_settings["rate_tph"]), port["berth_profiles"])
            berth_coords = {name: berth_map_coordinates(port, i, count) for i, name in enumerate(port["names"])}
            for idx, ship in enumerate(st.session_state.ship_details):
                fallback_lat, fallback_lon = ship_map_coordinates(port, idx, len(st.session_state.ship_details))
                ship_lat = float(ship.get("latitude", fallback_lat))
                ship_lon = float(ship.get("longitude", fallback_lon))
                color = ship_color(idx)
                match = scheduled_map[scheduled_map["Ship ID"] == ship["ship_id"]] if not scheduled_map.empty else pd.DataFrame()
                assigned = match.iloc[0]["Berth"] if not match.empty else "No compatible berth"
                icon_html = f'<div style="width:30px;height:30px;border-radius:50%;background:{color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#06101c;font-weight:800;font-size:10px;">{idx+1}</div>'
                folium.Marker([ship_lat, ship_lon], tooltip=f"{ship['ship_id']} | {ship['weight_tonnes']:,.0f} t",
                    popup=folium.Popup(f"<b>{ship['ship_id']}</b><br>Cargo: {ship['cargo_type']}<br>Load: {ship['weight_tonnes']:,.0f} t<br>LOA: {ship['loa_m']:.1f} m<br>Draft: {ship['draft_m']:.1f} m<br>Assigned berth: {assigned}", max_width=300),
                    icon=folium.DivIcon(html=icon_html)).add_to(ship_layer)
                if st.session_state.optimized and assigned in berth_coords:
                    bl, bo = berth_coords[assigned]
                    line = folium.PolyLine([[ship_lat, ship_lon], [bl, bo]], color=color, weight=3, opacity=0.9).add_to(ship_layer)
                    PolyLineTextPath(line, "➜", repeat=False, offset=55,
                                     attributes={"fill": color, "font-weight": "bold", "font-size": "20"}).add_to(ship_layer)
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
            "Green = available | Red = occupied/scheduled. "
            "Berths are arranged on the sea-facing side of the port as a schematic jetty row. "
            "Select a berth marker to inspect its current status."
        )

    # RIGHT SIDE
    with right_col:
        st.subheader("Optimization Summary")

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
                "Berth Utilization (%)",
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

        st.markdown("### Port Details")
        st.write(f"**State:** {port['state']}")
        st.write(f"**Berths:** {port['berths']}")
        st.write(f"**Data source:** {port['source']}")

    # BOTTOM - SCHEDULE + BERTH UTILIZATION
    bottom1, bottom2 = st.columns([1.35, 1])

    with bottom1:
        st.subheader("Ship Schedule (Optimized)")

        if st.session_state.ship_details:
            berth_schedule, _ = optimize_port_operations(st.session_state.ship_details, port["names"], int(st.session_state.crane_settings["cranes"]), float(st.session_state.crane_settings["rate_tph"]), port["berth_profiles"])
            st.dataframe(berth_schedule, hide_index=True, use_container_width=True, height=290)
        else:
            st.info("Add Ship Details to generate an individual ship schedule.")

    with bottom2:
        st.subheader("Berth Utilization")

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
        st.subheader("Throughput Over Time")

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
    st.header("Ship Details")
    erase_col, _ = st.columns([1, 3])
    with erase_col:
        if st.button("Erase All Ship Data", type="secondary", use_container_width=True):
            st.session_state.ship_details = []
            st.session_state.optimized = False
            st.session_state.selected_ship_id = None
            st.success("All ship data has been erased.")
            st.rerun()

    st.write("Enter the operational details for each ship. These records drive berth and crane optimization.")

    st.markdown("### Add Ship Details")
    with st.form("add_ship_form", clear_on_submit=True):
        f1, f2, f3 = st.columns(3)
        with f1:
            ship_id = st.text_input("Ship ID", placeholder="SHP-001")
            operator = st.text_input("Load operator / member", placeholder="Operator name")
            cargo_type = st.text_input("Cargo type", placeholder="Containers, grain, fruit, machinery")
            weight_tonnes = st.number_input("Load weight (tonnes)", min_value=1.0, value=1000.0, step=100.0)
            load_teu_ship = st.number_input("Load (TEU)", min_value=0, value=500, step=10)
        with f2:
            loa_m = st.number_input("Vessel LOA (m)", min_value=1.0, value=180.0, step=5.0)
            draft_m = st.number_input("Vessel draft (m)", min_value=0.5, value=9.0, step=0.5)
            unload_ship_hours = st.number_input("Estimated unloading time (hours)", min_value=0.25, value=8.0, step=0.25)
            latitude = st.slider(
                "Ship Latitude",
                min_value=-20.0,
                max_value=23.0,
                value=15.0,
                step=0.01,
                format="%.2f°",
                help="Move the slider to place the ship in the allowed Bay of Bengal / southern Indian Ocean operating area.",
            )
            longitude = st.slider(
                "Ship Longitude",
                min_value=75.0,
                max_value=100.0,
                value=85.0,
                step=0.01,
                format="%.2f°",
                help="Move the slider to place the ship in the allowed sea area.",
            )
        with f3:
            speed_knots = st.slider("Ship speed (knots)", min_value=1.0, max_value=30.0, value=12.0, step=0.5)
        spoilable = st.checkbox("Cargo is spoilable / time-sensitive")
        spoilage_window_hours = st.number_input(
            "Maximum time after arrival before spoilage (hours)",
            min_value=1.0,
            value=24.0,
            step=1.0,
            disabled=not spoilable,
        )

        add_ship = st.form_submit_button("Update", type="primary", use_container_width=True)

    if add_ship:
        new_id = ship_id.strip() or f"SHP-{len(st.session_state.ship_details)+1:03d}"
        # Departure is derived from the load: heavier loads require more preparation time.
        # Base preparation is 1 hour + 1 hour per 5,000 tonnes.
        load_departure_hours = 1.0 + (float(weight_tonnes) / 5000.0)
        distance_km = haversine_km(latitude, longitude, port["lat"], port["lon"])
        speed_kmh = max(float(speed_knots), 0.1) * 1.852
        travel_hours = distance_km / speed_kmh
        # The Update click is the reference moment. No manual arrival/departure time is entered.
        reference_time = datetime.now()
        departure_dt = reference_time + timedelta(hours=load_departure_hours)
        eta_dt = departure_dt + timedelta(hours=travel_hours)
        end_dt = eta_dt + timedelta(hours=float(unload_ship_hours))
        spoilage_dt = (
            eta_dt + timedelta(hours=float(spoilage_window_hours))
            if spoilable else None
        )
        if not valid_ship_position(latitude, longitude):
            st.error("Enter coordinates within the operating window: latitude -20° to 23° and longitude 75° to 100°.")
        elif distance_km < 5:
            st.error("The ship must be at least 5 km offshore from the selected port.")
        elif float(weight_tonnes) <= 0:
            st.error("Load weight must be greater than zero.")
        elif any(x["ship_id"].lower() == new_id.lower() for x in st.session_state.ship_details):
            st.error("That Ship ID already exists. Use a unique Ship ID.")
        else:
            st.session_state.ship_details.append({
                "ship_id": new_id, "operator": operator.strip() or "Unassigned",
                "cargo_type": cargo_type.strip() or "General cargo",
                "weight_tonnes": float(weight_tonnes), "load_teu": int(load_teu_ship),
                "loa_m": float(loa_m), "draft_m": float(draft_m),
                "unload_hours": float(unload_ship_hours),
                "start_dt": departure_dt, "expected_end": end_dt,
                "spoilable": bool(spoilable), "spoilage_deadline": spoilage_dt,
                "latitude": float(latitude), "longitude": float(longitude),
                "speed_knots": float(speed_knots), "distance_km": float(distance_km),
                "travel_hours": float(travel_hours), "eta": eta_dt, "updated_at": reference_time, "departure_prep_hours": load_departure_hours,
            })
            st.session_state.optimized = False
            st.success(
                f"Updated {new_id}. From the Update time ({reference_time.strftime('%d-%b-%Y %H:%M')}): "
                f"estimated departure = {departure_dt.strftime('%d-%b-%Y %H:%M')}; "
                f"estimated arrival = {eta_dt.strftime('%d-%b-%Y %H:%M')}."
            )

    st.markdown("### Current Ship Details")
    if st.session_state.ship_details:
        display_rows = [{
            "Ship ID": x["ship_id"], "Operator": x["operator"], "Cargo": x["cargo_type"],
            "Weight (t)": x["weight_tonnes"], "TEU": x["load_teu"], "LOA (m)": x["loa_m"], "Draft (m)": x["draft_m"],
            "Latitude": x.get("latitude", ""), "Longitude": x.get("longitude", ""),
            "Speed (knots)": x.get("speed_knots", ""), "Distance (km)": round(x.get("distance_km", 0), 1),
            "Estimated Departure": x["start_dt"].strftime("%d-%b %H:%M"),
            "ETA": x.get("eta").strftime("%d-%b %H:%M") if x.get("eta") else "-",
            "Updated At": x.get("updated_at").strftime("%d-%b %H:%M") if x.get("updated_at") else "-",
            "Start": x["start_dt"].strftime("%d-%b %H:%M"),
            "Expected End": x["expected_end"].strftime("%d-%b %H:%M"),
            "Unload (h)": x["unload_hours"], "Spoilable": "Yes" if x["spoilable"] else "No",
            "Spoilage Deadline": x["spoilage_deadline"].strftime("%d-%b %H:%M") if x["spoilage_deadline"] else "-",
        } for x in st.session_state.ship_details]
        st.dataframe(pd.DataFrame(display_rows), hide_index=True, use_container_width=True)
        if st.button("Clear All Ship Details", use_container_width=True):
            st.session_state.ship_details = []
            st.session_state.optimized = False
            st.rerun()
    else:
        st.info("No individual ship records have been added yet. Add each ship above to enable detailed optimization.")

    st.markdown("### Crane Transport Settings")
    cs1, cs2 = st.columns(2)
    with cs1:
        st.session_state.crane_settings["cranes"] = st.number_input("Available cranes", 1, 50, int(st.session_state.crane_settings["cranes"]), 1)
    with cs2:
        st.session_state.crane_settings["rate_tph"] = st.number_input("Transport capacity per crane (tonnes/hour)", 50.0, 10000.0, float(st.session_state.crane_settings["rate_tph"]), 50.0)
    st.caption("When transport jobs are ready at the same time, spoilable cargo takes precedence, followed by the nearest spoilage deadline and then the heavier load.")

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
    st.write("The optimizer combines berth scheduling with post-unloading crane transport. This prototype uses a deterministic scheduling model.")
    if not st.session_state.ship_details:
        st.info("Add Ship Details before running the detailed optimizer.")
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
    st.metric("Optimization status", "Completed" if st.session_state.optimized else "Not run")
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
        st.success("No emergency alerts.")
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
        "Port data is separated from the UI so additional Indian ports can be "
        "added later without rewriting the dashboard."
    )

st.markdown(
    f"""
    <div class="footer">
     Quantum Port Optimization Prototype | {port['short']} |
    Data source: {port['source']}
    </div>
    """,
    unsafe_allow_html=True,
)
