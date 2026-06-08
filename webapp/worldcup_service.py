import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

WC_JSON_URL = "https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json"
WC_JSON_URL_FALLBACK = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
CACHE_TTL_SECONDS = 3600
DATA_DIR = Path(__file__).resolve().parent / "data"
CACHE_FILE = DATA_DIR / "wc2026_cache.json"
FALLBACK_FILE = DATA_DIR / "wc2026.json"

# Nom équipe → code ISO (drapeaux flagcdn)
TEAM_CODES = {
    "Mexico": "mx",
    "South Africa": "za",
    "South Korea": "kr",
    "Czech Republic": "cz",
    "Canada": "ca",
    "Bosnia & Herzegovina": "ba",
    "Qatar": "qa",
    "Switzerland": "ch",
    "Brazil": "br",
    "Morocco": "ma",
    "Haiti": "ht",
    "Scotland": "gb-sct",
    "USA": "us",
    "Paraguay": "py",
    "Australia": "au",
    "Turkey": "tr",
    "Germany": "de",
    "Curaçao": "cw",
    "Ivory Coast": "ci",
    "Ecuador": "ec",
    "Netherlands": "nl",
    "Japan": "jp",
    "Sweden": "se",
    "Tunisia": "tn",
    "Belgium": "be",
    "Egypt": "eg",
    "Iran": "ir",
    "New Zealand": "nz",
    "Spain": "es",
    "Cape Verde": "cv",
    "Saudi Arabia": "sa",
    "Uruguay": "uy",
    "France": "fr",
    "Senegal": "sn",
    "Iraq": "iq",
    "Norway": "no",
    "Argentina": "ar",
    "Algeria": "dz",
    "Austria": "at",
    "Jordan": "jo",
    "Portugal": "pt",
    "DR Congo": "cd",
    "Uzbekistan": "uz",
    "Colombia": "co",
    "England": "gb-eng",
    "Croatia": "hr",
    "Ghana": "gh",
    "Panama": "pa",
}


def team_flag_url(team_name):
    code = TEAM_CODES.get(team_name)
    if code:
        return f"https://flagcdn.com/w40/{code}.png"
    return None


def parse_time_gmt1(date_str, time_str):
    """Convertit '13:00 UTC-6' → datetime affichable en GMT+1."""
    if not date_str or not time_str:
        return None, "—", "—"

    match = re.match(r"(\d{1,2}):(\d{2})\s*UTC([+-]?\d+)", str(time_str).strip())
    if not match:
        return None, time_str[:5] if len(time_str) >= 5 else time_str, date_str

    hour, minute, offset = int(match.group(1)), int(match.group(2)), int(match.group(3))
    try:
        local = datetime.strptime(f"{date_str} {hour:02d}:{minute:02d}", "%Y-%m-%d %H:%M")
    except ValueError:
        return None, f"{hour:02d}:{minute:02d}", date_str

    utc_dt = local - timedelta(hours=offset)
    gmt1_dt = utc_dt + timedelta(hours=1)
    return (
        gmt1_dt,
        gmt1_dt.strftime("%H:%M"),
        gmt1_dt.strftime("%d/%m/%Y"),
    )


def _load_raw_data():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if CACHE_FILE.exists():
        try:
            cached = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            if time.time() - cached.get("_fetched_at", 0) < CACHE_TTL_SECONDS:
                return cached.get("data") or cached
        except (json.JSONDecodeError, OSError):
            pass

    sources = []
    if FALLBACK_FILE.exists():
        sources.append(f"file://{FALLBACK_FILE}")
    sources.extend([WC_JSON_URL, WC_JSON_URL_FALLBACK])

    for source in sources:
        try:
            if source.startswith("file://"):
                path = Path(source.replace("file://", ""))
                data = json.loads(path.read_text(encoding="utf-8"))
            else:
                req = urllib.request.Request(source, headers={"User-Agent": "FootAAB/1.0"})
                with urllib.request.urlopen(req, timeout=12) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            CACHE_FILE.write_text(
                json.dumps({"_fetched_at": time.time(), "data": data}, ensure_ascii=False),
                encoding="utf-8",
            )
            return data
        except (urllib.error.URLError, json.JSONDecodeError, OSError, TimeoutError):
            continue

    if CACHE_FILE.exists():
        try:
            cached = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            return cached.get("data") or cached
        except (json.JSONDecodeError, OSError):
            pass

    return {"name": "World Cup 2026", "matches": []}


def _match_status(match_dt, score):
    if score is not None:
        return "finished"
    if match_dt and match_dt < datetime.now():
        return "live"
    return "scheduled"


def normalize_match(raw, index):
    score = None
    score_raw = raw.get("score")
    if isinstance(score_raw, dict) and "ft" in score_raw:
        ft = score_raw["ft"]
        if isinstance(ft, (list, tuple)) and len(ft) >= 2:
            score = {"home": int(ft[0]), "away": int(ft[1])}

    gmt1_dt, time_gmt1, date_gmt1 = parse_time_gmt1(raw.get("date"), raw.get("time"))
    group = raw.get("group") or ""
    round_name = raw.get("round") or ""

    return {
        "id": index,
        "num": raw.get("num"),
        "round": round_name,
        "group": group,
        "group_letter": group.replace("Group ", "").strip() if group.startswith("Group") else "",
        "date": raw.get("date"),
        "date_gmt1": date_gmt1,
        "time_gmt1": time_gmt1,
        "datetime_gmt1": gmt1_dt.isoformat() if gmt1_dt else None,
        "team1": raw.get("team1") or "TBD",
        "team2": raw.get("team2") or "TBD",
        "team1_flag": team_flag_url(raw.get("team1") or ""),
        "team2_flag": team_flag_url(raw.get("team2") or ""),
        "ground": raw.get("ground") or "",
        "score": score,
        "status": _match_status(gmt1_dt, score),
        "is_group": bool(group.startswith("Group")),
        "is_knockout": _is_knockout_round(round_name, group),
    }


KNOCKOUT_ROUNDS = {
    "Round of 32",
    "Round of 16",
    "Quarter-final",
    "Semi-final",
    "Match for third place",
    "Final",
}


def _is_knockout_round(round_name, group):
    if group and group.startswith("Group"):
        return False
    return round_name in KNOCKOUT_ROUNDS or bool(round_name and not group)


def compute_group_standings(matches):
    """Classement par groupe à partir des scores enregistrés."""
    groups = {}
    for m in matches:
        if not m["is_group"] or not m["score"]:
            continue
        letter = m["group_letter"]
        if not letter:
            continue
        groups.setdefault(letter, {})

        for team, gf, ga in [
            (m["team1"], m["score"]["home"], m["score"]["away"]),
            (m["team2"], m["score"]["away"], m["score"]["home"]),
        ]:
            row = groups[letter].setdefault(
                team,
                {"team": team, "played": 0, "won": 0, "drawn": 0, "lost": 0, "gf": 0, "ga": 0, "gd": 0, "pts": 0, "flag": team_flag_url(team)},
            )
            row["played"] += 1
            row["gf"] += gf
            row["ga"] += ga
            if gf > ga:
                row["won"] += 1
                row["pts"] += 3
            elif gf == ga:
                row["drawn"] += 1
                row["pts"] += 1
            else:
                row["lost"] += 1

    result = {}
    for letter, teams in groups.items():
        rows = list(teams.values())
        for r in rows:
            r["gd"] = r["gf"] - r["ga"]
        rows.sort(key=lambda x: (-x["pts"], -x["gd"], -x["gf"], x["team"]))
        result[letter] = rows

    return result


def build_worldcup_payload():
    raw = _load_raw_data()
    matches_raw = raw.get("matches") or []
    matches = [normalize_match(m, i) for i, m in enumerate(matches_raw)]

    matches.sort(key=lambda m: (m.get("datetime_gmt1") or m.get("date") or "", m["id"]))

    group_matches = [m for m in matches if m["is_group"]]
    knockout_matches = [m for m in matches if m["is_knockout"]]

    # Équipes par groupe (depuis le calendrier)
    group_teams = {}
    for m in group_matches:
        letter = m["group_letter"]
        if not letter:
            continue
        group_teams.setdefault(letter, set())
        if m["team1"] and not m["team1"].startswith(("1", "2", "3", "W", "L")):
            group_teams[letter].add(m["team1"])
        if m["team2"] and not m["team2"].startswith(("1", "2", "3", "W", "L")):
            group_teams[letter].add(m["team2"])

    standings = compute_group_standings(matches)

    # Prochains matchs
    now = datetime.now()
    upcoming = []
    for m in matches:
        if m["status"] == "finished":
            continue
        if m.get("datetime_gmt1"):
            try:
                dt = datetime.fromisoformat(m["datetime_gmt1"])
                if dt >= now - timedelta(hours=3):
                    upcoming.append(m)
            except ValueError:
                upcoming.append(m)
        else:
            upcoming.append(m)
    upcoming = upcoming[:8]

    finished_count = sum(1 for m in matches if m["status"] == "finished")

    return {
        "name": raw.get("name") or "Coupe du Monde 2026",
        "timezone_label": "GMT+1",
        "total_matches": len(matches),
        "finished_matches": finished_count,
        "groups": sorted(group_teams.keys()),
        "group_teams": {
            k: [{"name": t, "flag": team_flag_url(t)} for t in sorted(v)]
            for k, v in group_teams.items()
        },
        "standings": standings,
        "matches": matches,
        "group_matches": group_matches,
        "knockout_matches": knockout_matches,
        "upcoming": upcoming,
        "updated_at": datetime.now().strftime("%d/%m/%Y %H:%M"),
    }
