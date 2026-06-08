#!/usr/bin/env python3
"""Télécharge wc2026.json depuis openfootball (à lancer une fois sur le VPS)."""
import json
import urllib.request
from pathlib import Path

URL = "https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json"
OUT = Path(__file__).resolve().parent / "wc2026.json"

req = urllib.request.Request(URL, headers={"User-Agent": "FootAAB/1.0"})
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read().decode("utf-8"))

OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"OK: {len(data.get('matches', []))} matchs -> {OUT}")
