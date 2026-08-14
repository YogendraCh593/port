from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent / "ship_details.json"


def _encode(value):
    if isinstance(value, datetime):
        return {"__datetime__": value.isoformat()}
    raise TypeError(f"Unsupported value: {type(value)!r}")


def _decode(value):
    if isinstance(value, dict) and "__datetime__" in value:
        return datetime.fromisoformat(value["__datetime__"])
    if isinstance(value, dict):
        return {k: _decode(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_decode(v) for v in value]
    return value


def load_ship_details() -> list[dict]:
    if not DATA_FILE.exists():
        return []
    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        return _decode(payload if isinstance(payload, list) else [])
    except (OSError, json.JSONDecodeError, ValueError):
        return []


def save_ship_details(ships: list[dict]) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = DATA_FILE.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as f:
        json.dump(ships, f, default=_encode, indent=2)
    temp.replace(DATA_FILE)


def clear_ship_details() -> None:
    save_ship_details([])
