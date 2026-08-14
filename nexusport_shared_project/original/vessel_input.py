import math
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import streamlit as st

from nexusport_shared import load_ship_details, save_ship_details, clear_ship_details

st.set_page_config(page_title="NexusPort | Vessel Input", page_icon="⚓", layout="wide")

# Same port coordinates used by the original application.
PORTS = {
    "Kakinada Deep Water Port": (16.9750, 82.2790),
    "Visakhapatnam Port": (17.6868, 83.2185),
    "Paradip Port": (20.2669, 86.7056),
    "V.O. Chidambaranar Port": (8.7642, 78.1348),
}

st.markdown("""
<style>
.stApp { background:#07111f; color:#f4f8fc; }
.hero { padding:28px 32px; border:1px solid rgba(103,155,206,.22); border-radius:20px; background:linear-gradient(135deg,#0e1c2f,#102238); margin-bottom:22px; }
.title { font-size:42px; font-weight:700; letter-spacing:2px; }
.kicker { color:#22d3ee; font-weight:700; letter-spacing:2px; }
.sub { color:#91a7bf; margin-top:8px; }
</style>
""", unsafe_allow_html=True)


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2-lat1)
    dlambda = math.radians(lon2-lon1)
    a = math.sin(dphi/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlambda/2)**2
    return 2*r*math.asin(math.sqrt(a))


def valid_position(lat, lon):
    return -20 <= lat <= 23 and 75 <= lon <= 100

st.markdown('''<div class="hero"><div class="title">NEXUSPORT</div><div class="kicker">VESSEL INPUT & SHARED FLEET DATA</div><div class="sub">Enter vessel details here. The original NexusPort application reads these records automatically.</div></div>''', unsafe_allow_html=True)

selected_port = st.selectbox("Reference Port", list(PORTS.keys()))
port_lat, port_lon = PORTS[selected_port]

ships = load_ship_details()

with st.form("vessel_form", clear_on_submit=True):
    c1, c2, c3 = st.columns(3)
    with c1:
        ship_id = st.text_input("Ship ID", placeholder="SHP-001")
        operator = st.text_input("Load operator / member", placeholder="Operator name")
        cargo_type = st.text_input("Cargo type", placeholder="Containers, grain, fruit, machinery")
        weight = st.number_input("Load weight (tonnes)", min_value=1.0, value=1000.0, step=100.0)
        teu = st.number_input("Load (TEU)", min_value=0, value=500, step=10)
    with c2:
        loa = st.number_input("Vessel LOA (m)", min_value=1.0, value=180.0, step=5.0)
        draft = st.number_input("Vessel draft (m)", min_value=0.5, value=9.0, step=0.5)
        unload = st.number_input("Estimated unloading time (hours)", min_value=0.25, value=8.0, step=0.25)
        latitude = st.slider("Ship Latitude", -20.0, 23.0, 15.0, 0.01, format="%.2f°")
        longitude = st.slider("Ship Longitude", 75.0, 100.0, 85.0, 0.01, format="%.2f°")
    with c3:
        speed = st.slider("Ship speed (knots)", 1.0, 30.0, 12.0, 0.5)
        spoilable = st.checkbox("Cargo is spoilable / time-sensitive")
        spoil_window = st.number_input("Maximum time after arrival before spoilage (hours)", 1.0, 10000.0, 24.0, 1.0, disabled=not spoilable)
        st.info("Departure is calculated automatically from load weight, just as in the original application.")

    submitted = st.form_submit_button("UPDATE SHARED VESSEL DATA", type="primary", use_container_width=True)

if submitted:
    new_id = ship_id.strip() or f"SHP-{len(ships)+1:03d}"
    now = datetime.now()
    prep = 1.0 + weight / 5000.0
    distance = haversine_km(latitude, longitude, port_lat, port_lon)
    travel = distance / max(speed * 1.852, 0.1)
    departure = now + timedelta(hours=prep)
    eta = departure + timedelta(hours=travel)
    expected_end = eta + timedelta(hours=unload)
    spoil_deadline = eta + timedelta(hours=spoil_window) if spoilable else None

    if not valid_position(latitude, longitude):
        st.error("Coordinates must be within latitude -20° to 23° and longitude 75° to 100°.")
    elif distance < 5:
        st.error("The ship must be at least 5 km offshore from the selected port.")
    elif any(s.get("ship_id", "").lower() == new_id.lower() for s in ships):
        st.error("That Ship ID already exists. Use a unique Ship ID.")
    else:
        ships.append({
            "ship_id": new_id,
            "operator": operator.strip() or "Unassigned",
            "cargo_type": cargo_type.strip() or "General cargo",
            "weight_tonnes": float(weight),
            "load_teu": int(teu),
            "loa_m": float(loa),
            "draft_m": float(draft),
            "unload_hours": float(unload),
            "start_dt": departure,
            "expected_end": expected_end,
            "spoilable": bool(spoilable),
            "spoilage_deadline": spoil_deadline,
            "latitude": float(latitude),
            "longitude": float(longitude),
            "speed_knots": float(speed),
            "distance_km": float(distance),
            "travel_hours": float(travel),
            "eta": eta,
            "updated_at": now,
            "departure_prep_hours": prep,
            "reference_port": selected_port,
        })
        save_ship_details(ships)
        st.success(f"{new_id} saved to the shared vessel store. Open/refresh the original NexusPort application to use it.")

st.markdown("---")
st.subheader("Shared Vessel Records")
ships = load_ship_details()
if ships:
    rows = []
    for x in ships:
        rows.append({
            "Ship ID": x["ship_id"], "Operator": x["operator"], "Cargo": x["cargo_type"],
            "Weight (t)": x["weight_tonnes"], "TEU": x["load_teu"], "LOA (m)": x["loa_m"],
            "Draft (m)": x["draft_m"], "Latitude": x["latitude"], "Longitude": x["longitude"],
            "Speed": x["speed_knots"], "Distance (km)": round(x["distance_km"],1),
            "ETA": x["eta"].strftime("%d-%b %H:%M"), "Unload End": x["expected_end"].strftime("%d-%b %H:%M"),
            "Spoilable": "Yes" if x["spoilable"] else "No",
        })
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
    col1, col2 = st.columns(2)
    with col1:
        if st.button("Clear Shared Vessel Data", use_container_width=True):
            clear_ship_details()
            st.rerun()
    with col2:
        csv = pd.DataFrame(rows).to_csv(index=False).encode("utf-8")
        st.download_button("Download Vessel CSV", csv, "nexusport_vessels.csv", "text/csv", use_container_width=True)
else:
    st.info("No shared vessel records yet.")
