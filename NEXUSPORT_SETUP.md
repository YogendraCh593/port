# NexusPort – Full-Stack Setup

## Architecture

```
Quantum/
├── backend/          Python FastAPI backend (all live.py logic)
│   ├── main.py       REST API server
│   ├── requirements.txt
│   └── start.bat     One-click Windows launcher
└── src/              React + TypeScript frontend
    └── services/api.ts  Typed API service layer
```

## 1. Start the Backend

```powershell
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Or double-click `backend/start.bat`.

API docs: http://localhost:8000/docs

## 2. Start the Frontend

```powershell
# from the project root
npm run dev
```

Frontend: http://localhost:5173

## Ports Supported (from live.py)

| Port | State | Berths |
|------|-------|--------|
| Kakinada Deep Water Port | Andhra Pradesh | 7 |
| Visakhapatnam Port | Andhra Pradesh | 26 |
| Paradip Port | Odisha | 18 |
| V.O. Chidambaranar Port | Tamil Nadu | 12 |

Switch ports from **Settings → Port Selection**.

## Key API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /ports` | List all 4 ports |
| `POST /ports/select` | Switch active port |
| `GET /vessels` | Registered vessels |
| `POST /vessels` | Register a vessel |
| `POST /optimize` | Run QUBO/QAOA optimizer |
| `GET /map/snapshot` | Live ship + berth positions |
| `GET /dashboard/kpis` | All KPI metrics |
| `GET /alerts` | Operational alerts |
| `GET /analytics` | 7-day historical data |
