import math
from datetime import datetime, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st


# ============================================================
# NEXUSPORT - STREAMLIT VESSEL INPUT APPLICATION
# Standalone implementation based on the supplied application.
# ============================================================

st.set_page_config(
    page_title="NexusPort | Vessel Operations",
    page_icon="⚓",
    layout="wide",
    initial_sidebar_state="expanded",
)


# ------------------------------------------------------------
# Styling
# ------------------------------------------------------------
st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

    :root {
        --bg: #07111f;
        --surface: #0e1c2f;
        --surface2: #102238;
        --border: rgba(103,155,206,.22);
        --text: #f4f8fc;
        --muted: #91a7bf;
        --cyan: #22d3ee;
        --blue: #4f8cff;
        --green: #34d399;
        --amber: #fbbf24;
        --red: #fb7185;
    }

    html, body, [class*="css"], .stApp, .stApp * {
        font-family: 'DM Sans', sans-serif !important;
    }

    .stApp {
        background:
            radial-gradient(circle at 10% 0%, rgba(34,211,238,.08), transparent 28%),
            radial-gradient(circle at 90% 10%, rgba(79,140,255,.09), transparent 30%),
            var(--bg);
        color: var(--text);
    }

    .hero {
        padding: 28px 32px;
        border: 1px solid var(--border);
        border-radius: 20px;
        background: linear-gradient(135deg, rgba(14,28,47,.96), rgba(16,34,56,.78));
        box-shadow: 0 18px 50px rgba(0,0,0,.22);
        margin-bottom: 22px;
    }

    .hero-title {
        font-family: 'Space Grotesk', sans-serif !important;
        font-size: 42px;
        font-weight: 700;
        letter-spacing: 2px;
    }

    .hero-kicker {
        color: var(--cyan);
        font-weight: 700;
        letter-spacing: 2px;
        margin-top: 3px;
    }

    .hero-sub {
        color: var(--muted);
        margin-top: 8px;
        font-size: 15px;
    }

    .panel {
        background: rgba(14,28,47,.82);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 18px;
        margin-bottom: 14px;
    }

    .metric-card {
        background: rgba(14,28,47,.88);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 16px;
        min-height: 100px;
    }

    .metric-label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    .metric-value {
        color: var(--text);
        font-family: 'Space Grotesk', sans-serif !important;
        font-size: 26px;
        font-weight: 700;
        margin-top: 5px;
    }

    div[data-testid="stSidebar"] {
        background: #081522;
        border-right: 1px solid var(--border);
    }

    .stButton > button {
        border-radius: 10px !important;
        font-weight: 700 !important;
    }

    .small-note {
        color: var(--muted);
        font-size: 12px;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


# ------------------------------------------------------------
# Port configuration
# ------------------------------------------------------------
PORTS = {
    "Chennai Port": {
        "short": "CHENNAI PORT",
        "state": "Tamil Nadu, India",
        "lat": 13.0827,
        "lon": 80.2707,
        "berths": 5,
        "notes": "Prototype planning profile for demonstration.",
    },
    "Visakhapatnam Port": {
        "short": "VISAKHAPATNAM PORT",
        "state": "Andhra Pradesh, India",
        "lat": 17.6868,
        "lon": 83.2185,
        "berths": 5,
        "notes": "Prototype planning profile for demonstration.",
    },
    "Krishnapatnam Port": {
        "short": "KRISHNAPATNAM PORT",
        "state": "Andhra Pradesh, India",
        "lat": 14.2513,
        "lon": 80.1232,
        "berths": 5,
        "notes": "Prototype planning profile for demonstration.",
    },
}


# ------------------------------------------------------------
# Session state
# ------------------------------------------------------------
if "ship_details" not in st.session_state:
    st.session_state.ship_details = []

if "cranes" not in st.session_state:
    st.session_state.cranes = 4

if "rate_tph" not in st.session_state:
    st.session_state.rate_tph = 500.0

if "optimized" not in st.session_state:
    st.session_state.optimized = False


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance between two coordinates."""
    earth_radius = 6371.0088

    p1 = math.radians(lat1)
    p2 = math.radians(lat2)

    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(p1)
        * math.cos(p2)
        * math.sin(dlambda / 2) ** 2
    )

    return 2 * earth_radius * math.asin(math.sqrt(a))


def valid_ship_position(lat, lon):
    return -20.0 <= lat <= 23.0 and 75.0 <= lon <= 100.0


def calculate_eta(ship, port):
    distance_km = haversine_km(
        ship["latitude"],
        ship["longitude"],
        port["lat"],
        port["lon"],
    )

    speed_kmh = max(ship["speed_knots"], 0.1) * 1.852
    travel_hours = distance_km / speed_kmh

    departure = ship["start_dt"]
    eta = departure + timedelta(hours=travel_hours)

    return distance_km, travel_hours, eta


def status_for_ship(ship, now):
    if now < ship["start_dt"]:
        return "Preparing"
    if now < ship["eta"]:
        return "At Sea"
    if now < ship["expected_end"]:
        return "At Port"
    return "Completed"


def optimize_berths(ships, port):
    """Simple deterministic berth allocation for the standalone prototype."""
    berth_names = [f"Berth {i + 1}" for i in range(port["berths"])]

    # Heavier / spoilable vessels receive earlier priority.
    ordered = sorted(
        ships,
        key=lambda x: (
            not x["spoilable"],
            x["spoilage_deadline"] or datetime.max,
            -x["weight_tonnes"],
        ),
    )

    berth_available = {b: datetime.min for b in berth_names}
    rows = []

    for ship in ordered:
        compatible = list(berth_names)

        berth = min(compatible, key=lambda b: berth_available[b])

        requested = ship["eta"]
        actual_start = max(requested, berth_available[berth])
        unload_end = actual_start + timedelta(hours=ship["unload_hours"])

        wait = (actual_start - requested).total_seconds() / 3600

        if ship["spoilable"] and ship["spoilage_deadline"]:
            if actual_start > ship["spoilage_deadline"]:
                status = "Deadline Risk"
            else:
                status = "Allocated"
        else:
            status = "Allocated"

        berth_available[berth] = unload_end

        rows.append(
            {
                "Ship ID": ship["ship_id"],
                "Berth": berth,
                "Cargo": ship["cargo_type"],
                "Weight (t)": round(ship["weight_tonnes"], 1),
                "Requested Arrival": requested.strftime("%d-%b %H:%M"),
                "Actual Start": actual_start.strftime("%d-%b %H:%M"),
                "Unload End": unload_end.strftime("%d-%b %H:%M"),
                "Berth Wait (h)": round(wait, 2),
                "Status": status,
            }
        )

    return pd.DataFrame(rows)


def optimize_cranes(ships, berth_df):
    if berth_df.empty:
        return pd.DataFrame()

    ship_lookup = {x["ship_id"]: x for x in ships}

    # Transport priority:
    # 1. spoilable cargo
    # 2. earliest spoilage deadline
    # 3. heavier load
    jobs = sorted(
        berth_df.to_dict("records"),
        key=lambda r: (
            not ship_lookup[r["Ship ID"]]["spoilable"],
            ship_lookup[r["Ship ID"]]["spoilage_deadline"] or datetime.max,
            -float(r["Weight (t)"]),
        ),
    )

    crane_available = {
        f"Crane {i + 1}": datetime.min
        for i in range(st.session_state.cranes)
    }

    rows = []

    for job in jobs:
        ship = ship_lookup[job["Ship ID"]]

        ready_after = datetime.strptime(
            job["Unload End"], "%d-%b %H:%M"
        ).replace(
            year=datetime.now().year
        )

        crane = min(crane_available, key=lambda c: crane_available[c])

        transport_start = max(ready_after, crane_available[crane])
        transport_hours = float(job["Weight (t)"]) / st.session_state.rate_tph
        transport_end = transport_start + timedelta(hours=transport_hours)

        crane_available[crane] = transport_end

        if ship["spoilable"]:
            reason = "Spoilable cargo priority"
        else:
            reason = "Standard cargo priority"

        rows.append(
            {
                "Ship ID": job["Ship ID"],
                "Berth": job["Berth"],
                "Crane": crane,
                "Weight (t)": job["Weight (t)"],
                "Spoilable": "Yes" if ship["spoilable"] else "No",
                "Transport Start": transport_start.strftime("%d-%b %H:%M"),
                "Transport End": transport_end.strftime("%d-%b %H:%M"),
                "Priority Reason": reason,
            }
        )

    return pd.DataFrame(rows)


# ------------------------------------------------------------
# Sidebar
# ------------------------------------------------------------
st.sidebar.markdown("## ⚓ NEXUSPORT")
st.sidebar.caption("Intelligent Maritime Operations")

selected_port_name = st.sidebar.selectbox(
    "Operating Port",
    list(PORTS.keys()),
)

port = PORTS[selected_port_name]

page = st.sidebar.radio(
    "Navigation",
    [
        "Vessel Input",
        "Live Fleet",
        "Berth Optimization",
        "Crane Optimization",
        "Analytics",
    ],
)

st.sidebar.markdown("---")

st.session_state.cranes = st.sidebar.number_input(
    "Available Cranes",
    min_value=1,
    max_value=50,
    value=int(st.session_state.cranes),
    step=1,
)

st.session_state.rate_tph = st.sidebar.number_input(
    "Transport Capacity / Crane (t/h)",
    min_value=50.0,
    max_value=10000.0,
    value=float(st.session_state.rate_tph),
    step=50.0,
)


# ------------------------------------------------------------
# Header
# ------------------------------------------------------------
st.markdown(
    f"""
    <div class="hero">
        <div class="hero-title">NEXUSPORT</div>
        <div class="hero-kicker">INTELLIGENT MARITIME OPERATIONS</div>
        <div class="hero-sub">
            Vessel intake, ETA calculation, berth planning and crane
            optimization • {port["short"]}
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)


# ============================================================
# VESSEL INPUT
# ============================================================
if page == "Vessel Input":

    st.header("Add Vessel Details")

    st.write(
        "Enter the operational details for each ship. "
        "These records drive berth and crane optimization."
    )

    with st.form("add_ship_form", clear_on_submit=True):

        f1, f2, f3 = st.columns(3)

        with f1:
            ship_id = st.text_input(
                "Ship ID",
                placeholder="SHP-001",
            )

            operator = st.text_input(
                "Load operator / member",
                placeholder="Operator name",
            )

            cargo_type = st.text_input(
                "Cargo type",
                placeholder="Containers, grain, fruit, machinery",
            )

            weight_tonnes = st.number_input(
                "Load weight (tonnes)",
                min_value=1.0,
                value=1000.0,
                step=100.0,
            )

            load_teu = st.number_input(
                "Load (TEU)",
                min_value=0,
                value=500,
                step=10,
            )

        with f2:
            loa_m = st.number_input(
                "Vessel LOA (m)",
                min_value=1.0,
                value=180.0,
                step=5.0,
            )

            draft_m = st.number_input(
                "Vessel draft (m)",
                min_value=0.5,
                value=9.0,
                step=0.5,
            )

            unload_hours = st.number_input(
                "Estimated unloading time (hours)",
                min_value=0.25,
                value=8.0,
                step=0.25,
            )

            latitude = st.slider(
                "Ship Latitude",
                min_value=-20.0,
                max_value=23.0,
                value=15.0,
                step=0.01,
                format="%.2f°",
            )

            longitude = st.slider(
                "Ship Longitude",
                min_value=75.0,
                max_value=100.0,
                value=85.0,
                step=0.01,
                format="%.2f°",
            )

        with f3:
            speed_knots = st.slider(
                "Ship speed (knots)",
                min_value=1.0,
                max_value=30.0,
                value=12.0,
                step=0.5,
            )

            st.markdown(
                """
                <div class="panel">
                    <b>Automatic calculations</b><br><br>
                    Departure preparation time<br>
                    Distance to port<br>
                    Travel duration<br>
                    ETA<br>
                    Expected unloading completion<br>
                    Spoilage deadline
                </div>
                """,
                unsafe_allow_html=True,
            )

        spoilable = st.checkbox(
            "Cargo is spoilable / time-sensitive"
        )

        spoilage_window_hours = st.number_input(
            "Maximum time after arrival before spoilage (hours)",
            min_value=1.0,
            value=24.0,
            step=1.0,
            disabled=not spoilable,
        )

        submitted = st.form_submit_button(
            "UPDATE VESSEL",
            type="primary",
            use_container_width=True,
        )

    if submitted:

        new_id = (
            ship_id.strip()
            or f"SHP-{len(st.session_state.ship_details) + 1:03d}"
        )

        if not valid_ship_position(latitude, longitude):
            st.error(
                "Enter coordinates within the operating window: "
                "latitude -20° to 23° and longitude 75° to 100%."
            )

        elif any(
            x["ship_id"].lower() == new_id.lower()
            for x in st.session_state.ship_details
        ):
            st.error("That Ship ID already exists. Use a unique Ship ID.")

        elif weight_tonnes <= 0:
            st.error("Load weight must be greater than zero.")

        else:
            reference_time = datetime.now()

            # Same preparation model as the supplied application:
            # 1 hour + 1 hour per 5,000 tonnes.
            departure_prep_hours = 1.0 + weight_tonnes / 5000.0

            departure_dt = reference_time + timedelta(
                hours=departure_prep_hours
            )

            distance_km = haversine_km(
                latitude,
                longitude,
                port["lat"],
                port["lon"],
            )

            if distance_km < 5:
                st.error(
                    "The ship must be at least 5 km offshore "
                    "from the selected port."
                )
            else:
                speed_kmh = max(speed_knots, 0.1) * 1.852
                travel_hours = distance_km / speed_kmh

                eta_dt = departure_dt + timedelta(
                    hours=travel_hours
                )

                expected_end = eta_dt + timedelta(
                    hours=unload_hours
                )

                spoilage_dt = (
                    eta_dt
                    + timedelta(hours=spoilage_window_hours)
                    if spoilable
                    else None
                )

                ship = {
                    "ship_id": new_id,
                    "operator": operator.strip() or "Unassigned",
                    "cargo_type": cargo_type.strip() or "General cargo",
                    "weight_tonnes": float(weight_tonnes),
                    "load_teu": int(load_teu),
                    "loa_m": float(loa_m),
                    "draft_m": float(draft_m),
                    "unload_hours": float(unload_hours),
                    "latitude": float(latitude),
                    "longitude": float(longitude),
                    "speed_knots": float(speed_knots),
                    "distance_km": float(distance_km),
                    "travel_hours": float(travel_hours),
                    "start_dt": departure_dt,
                    "eta": eta_dt,
                    "expected_end": expected_end,
                    "spoilable": bool(spoilable),
                    "spoilage_deadline": spoilage_dt,
                    "updated_at": reference_time,
                }

                st.session_state.ship_details.append(ship)
                st.session_state.optimized = False

                st.success(
                    f"Updated {new_id}. "
                    f"Estimated departure: "
                    f"{departure_dt:%d-%b-%Y %H:%M}; "
                    f"estimated arrival: "
                    f"{eta_dt:%d-%b-%Y %H:%M}."
                )

    st.markdown("---")
    st.subheader("Current Vessel Details")

    if st.session_state.ship_details:

        rows = []

        for ship in st.session_state.ship_details:
            rows.append(
                {
                    "Ship ID": ship["ship_id"],
                    "Operator": ship["operator"],
                    "Cargo": ship["cargo_type"],
                    "Weight (t)": ship["weight_tonnes"],
                    "TEU": ship["load_teu"],
                    "LOA (m)": ship["loa_m"],
                    "Draft (m)": ship["draft_m"],
                    "Latitude": ship["latitude"],
                    "Longitude": ship["longitude"],
                    "Speed (knots)": ship["speed_knots"],
                    "Distance (km)": round(ship["distance_km"], 1),
                    "Departure": ship["start_dt"].strftime(
                        "%d-%b %H:%M"
                    ),
                    "ETA": ship["eta"].strftime(
                        "%d-%b %H:%M"
                    ),
                    "Unload End": ship["expected_end"].strftime(
                        "%d-%b %H:%M"
                    ),
                    "Spoilable": "Yes"
                    if ship["spoilable"]
                    else "No",
                    "Spoilage Deadline": (
                        ship["spoilage_deadline"].strftime(
                            "%d-%b %H:%M"
                        )
                        if ship["spoilage_deadline"]
                        else "-"
                    ),
                }
            )

        st.dataframe(
            pd.DataFrame(rows),
            hide_index=True,
            use_container_width=True,
        )

        col1, col2 = st.columns(2)

        with col1:
            if st.button(
                "Clear All Vessel Details",
                use_container_width=True,
            ):
                st.session_state.ship_details = []
                st.session_state.optimized = False
                st.rerun()

        with col2:
            csv = pd.DataFrame(rows).to_csv(index=False).encode("utf-8")
            st.download_button(
                "Download Vessel Data CSV",
                data=csv,
                file_name="nexusport_vessels.csv",
                mime="text/csv",
                use_container_width=True,
            )

    else:
        st.info("No vessel records have been added yet.")


# ============================================================
# LIVE FLEET
# ============================================================
elif page == "Live Fleet":

    st.header("Live Fleet")

    if not st.session_state.ship_details:
        st.info("Add vessel details first.")
    else:
        now = datetime.now()

        fleet_rows = []

        for ship in st.session_state.ship_details:
            status = status_for_ship(ship, now)

            fleet_rows.append(
                {
                    "Ship ID": ship["ship_id"],
                    "Cargo": ship["cargo_type"],
                    "Status": status,
                    "Latitude": round(ship["latitude"], 4),
                    "Longitude": round(ship["longitude"], 4),
                    "ETA": ship["eta"].strftime(
                        "%d-%b %H:%M"
                    ),
                    "Distance (km)": round(ship["distance_km"], 1),
                }
            )

        st.dataframe(
            pd.DataFrame(fleet_rows),
            hide_index=True,
            use_container_width=True,
        )

        # Approximate live position visualization.
        map_rows = []

        for ship in st.session_state.ship_details:
            if now <= ship["start_dt"]:
                lat = ship["latitude"]
                lon = ship["longitude"]

            elif now >= ship["eta"]:
                lat = port["lat"]
                lon = port["lon"]

            else:
                total = (
                    ship["eta"] - ship["start_dt"]
                ).total_seconds()

                elapsed = (
                    now - ship["start_dt"]
                ).total_seconds()

                ratio = min(1.0, max(0.0, elapsed / total))

                lat = ship["latitude"] + (
                    port["lat"] - ship["latitude"]
                ) * ratio

                lon = ship["longitude"] + (
                    port["lon"] - ship["longitude"]
                ) * ratio

            map_rows.append(
                {
                    "Ship": ship["ship_id"],
                    "Latitude": lat,
                    "Longitude": lon,
                    "Size": max(8, min(30, ship["weight_tonnes"] / 100)),
                }
            )

        df = pd.DataFrame(map_rows)

        fig = go.Figure()

        fig.add_trace(
            go.Scattergeo(
                lat=[port["lat"]],
                lon=[port["lon"]],
                mode="markers+text",
                text=[port["short"]],
                textposition="top center",
                marker=dict(size=16),
                name="Port",
            )
        )

        fig.add_trace(
            go.Scattergeo(
                lat=df["Latitude"],
                lon=df["Longitude"],
                mode="markers+text",
                text=df["Ship"],
                textposition="top center",
                marker=dict(
                    size=df["Size"],
                    symbol="circle",
                ),
                name="Vessels",
            )
        )

        fig.update_geos(
            showcountries=True,
            showland=True,
            showocean=True,
            projection_type="natural earth",
        )

        fig.update_layout(
            height=560,
            margin=dict(l=0, r=0, t=20, b=0),
            paper_bgcolor="#07111f",
            font=dict(color="#dbe7f3"),
        )

        st.plotly_chart(fig, use_container_width=True)


# ============================================================
# BERTH OPTIMIZATION
# ============================================================
elif page == "Berth Optimization":

    st.header("Berth Optimization")

    if not st.session_state.ship_details:
        st.info("Add vessel details before running berth optimization.")

    else:

        if st.button(
            "RUN BERTH OPTIMIZATION",
            type="primary",
            use_container_width=True,
        ):
            st.session_state.optimized = True

        berth_df = optimize_berths(
            st.session_state.ship_details,
            port,
        )

        st.subheader("Optimized Berth Schedule")

        st.dataframe(
            berth_df,
            hide_index=True,
            use_container_width=True,
        )

        total_wait = (
            berth_df["Berth Wait (h)"].sum()
            if not berth_df.empty
            else 0
        )

        c1, c2, c3 = st.columns(3)

        with c1:
            st.markdown(
                f"""
                <div class="metric-card">
                    <div class="metric-label">Vessels</div>
                    <div class="metric-value">{len(berth_df)}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )

        with c2:
            st.markdown(
                f"""
                <div class="metric-card">
                    <div class="metric-label">Total Berth Wait</div>
                    <div class="metric-value">{total_wait:.1f} h</div>
                </div>
                """,
                unsafe_allow_html=True,
            )

        with c3:
            risk_count = (
                int(
                    (
                        berth_df["Status"]
                        == "Deadline Risk"
                    ).sum()
                )
                if not berth_df.empty
                else 0
            )

            st.markdown(
                f"""
                <div class="metric-card">
                    <div class="metric-label">Deadline Risks</div>
                    <div class="metric-value">{risk_count}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )


# ============================================================
# CRANE OPTIMIZATION
# ============================================================
elif page == "Crane Optimization":

    st.header("Crane Optimization")

    if not st.session_state.ship_details:
        st.info("Add vessel details first.")

    else:

        berth_df = optimize_berths(
            st.session_state.ship_details,
            port,
        )

        if st.button(
            "OPTIMIZE CRANE ASSIGNMENTS",
            type="primary",
            use_container_width=True,
        ):
            st.session_state.optimized = True

        crane_df = optimize_cranes(
            st.session_state.ship_details,
            berth_df,
        )

        st.subheader("Crane Assignment")

        if crane_df.empty:
            st.info("No crane jobs available.")
        else:
            st.dataframe(
                crane_df,
                hide_index=True,
                use_container_width=True,
            )

            crane_loads = (
                crane_df.groupby("Crane")["Weight (t)"]
                .sum()
                .reindex(
                    [
                        f"Crane {i + 1}"
                        for i in range(st.session_state.cranes)
                    ],
                    fill_value=0,
                )
            )

            fig = go.Figure(
                go.Bar(
                    x=crane_loads.index,
                    y=crane_loads.values,
                    text=crane_loads.values,
                    textposition="outside",
                )
            )

            fig.update_layout(
                title="Crane Load Utility",
                height=380,
                paper_bgcolor="#07111f",
                plot_bgcolor="#07111f",
                font=dict(color="#dbe7f3"),
                yaxis_title="Assigned load (tonnes)",
            )

            st.plotly_chart(
                fig,
                use_container_width=True,
            )


# ============================================================
# ANALYTICS
# ============================================================
elif page == "Analytics":

    st.header("Operations Analytics")

    if not st.session_state.ship_details:
        st.info("Add vessel details first.")

    else:

        ships = st.session_state.ship_details

        total_weight = sum(
            x["weight_tonnes"] for x in ships
        )

        total_teu = sum(
            x["load_teu"] for x in ships
        )

        avg_unload = sum(
            x["unload_hours"] for x in ships
        ) / len(ships)

        spoilable_count = sum(
            1 for x in ships if x["spoilable"]
        )

        c1, c2, c3, c4 = st.columns(4)

        metrics = [
            ("Vessels", len(ships)),
            ("Total Cargo", f"{total_weight:,.0f} t"),
            ("Total TEU", f"{total_teu:,}"),
            ("Spoilable Cargo", spoilable_count),
        ]

        for col, (label, value) in zip(
            [c1, c2, c3, c4],
            metrics,
        ):
            with col:
                st.markdown(
                    f"""
                    <div class="metric-card">
                        <div class="metric-label">{label}</div>
                        <div class="metric-value">{value}</div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

        st.markdown("---")

        cargo_df = pd.DataFrame(
            [
                {
                    "Ship ID": x["ship_id"],
                    "Cargo": x["cargo_type"],
                    "Weight": x["weight_tonnes"],
                    "TEU": x["load_teu"],
                    "Unloading Hours": x["unload_hours"],
                }
                for x in ships
            ]
        )

        st.subheader("Cargo Weight by Vessel")

        fig = go.Figure(
            go.Bar(
                x=cargo_df["Ship ID"],
                y=cargo_df["Weight"],
                text=cargo_df["Weight"],
                textposition="outside",
            )
        )

        fig.update_layout(
            height=380,
            paper_bgcolor="#07111f",
            plot_bgcolor="#07111f",
            font=dict(color="#dbe7f3"),
            yaxis_title="Cargo weight (tonnes)",
        )

        st.plotly_chart(
            fig,
            use_container_width=True,
        )

        st.subheader("Fleet Summary")

        st.write(
            f"Average unloading time: **{avg_unload:.2f} hours/vessel**"
        )

        st.caption(
            "This standalone application is intended as a planning/demo "
            "prototype. Verify berth-level authority/GIS engineering data "
            "before operational use."
        )
