# NexusPort Shared Vessel Data

## Applications

- `vessel_input.py` — enter vessel details.
- `nexusport.py` — original NexusPort application with the existing dashboard, live simulation, berth, yard, crane, optimization, results, analytics, alerts, reports and settings features intact.
- `nexusport_shared.py` — shared persistence layer.
- `ship_details.json` — created automatically when the first vessel is saved.

## Run

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the vessel input application:

```bash
streamlit run vessel_input.py
```

In another terminal, start the original application:

```bash
streamlit run nexusport.py
```

Both applications must be run from the same project directory so they use the same `ship_details.json` file.

## Data flow

`vessel_input.py` writes vessel records to `ship_details.json`. `nexusport.py` reloads that file on every Streamlit rerun and passes the resulting `ship_details` list to the existing optimization and simulation code.

Only vessel input ownership was changed. Port definitions, berth profiles, quantum/QUBO optimization, crane optimization, yard, maps, movement/anchorage simulation, results, analytics, alerts, reports and settings were not replaced.
