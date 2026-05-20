import calendar as month_calendar
import json
import os
import random
from datetime import date, datetime

from flask import Blueprint, current_app, jsonify, render_template, request

from auth_utils import is_session_admin
from match_format import format_max_players
from routes.admin_utils import admin_guard


calendar_bp = Blueprint("calendar", __name__, url_prefix="/")

VALID_FORMATS = {"5v5", "6v6", "7v7", "8v8", "11v11"}
VALID_EVENT_KINDS = {"training", "match"}


def _parse_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _result_code(match):
    if match["score_a"] is None or match["score_b"] is None:
        return None
    if match["score_a"] > match["score_b"]:
        return "V"
    if match["score_a"] < match["score_b"]:
        return "D"
    return "N"


def _current_streak(matches):
    if not matches:
        return "-"

    first = _result_code(matches[0])
    if first is None:
        return "-"

    count = 0
    for item in matches:
        if _result_code(item) != first:
            break
        count += 1
    return f"{count}{first}"


def _event_type_for_row(item):
    if str(item.get("event_kind") or "").lower() == "match":
        return "match"
    status_key = str(item.get("status") or "").lower()
    if status_key in ("training", "entrainement"):
        return "training"
    if status_key in ("scheduled", "done", "cancelled"):
        return "training" if str(item.get("event_kind") or "training") == "training" else "match"
    return "other"


@calendar_bp.route("/calendrier", methods=["GET"])
def calendar_page():
    conn = current_app.get_db_connection()
    today = date.today()
    req_month = request.args.get("month", type=int) or today.month
    req_year = request.args.get("year", type=int) or today.year

    req_month = 1 if req_month < 1 else 12 if req_month > 12 else req_month
    req_year = max(1970, req_year)

    total_players = (
        conn.execute("SELECT COUNT(*) AS count FROM players WHERE active = 1").fetchone()["count"] or 0
    )

    rows = conn.execute(
        """
        SELECT
          m.id,
          m.date,
          m.time,
          m.location,
          m.status,
          m.event_kind,
          m.opponent,
          m.format,
          m.maps_url,
          m.notes,
          m.poll_sent_at,
          m.lineup_notified_at,
          m.score_a,
          m.score_b,
          COALESCE(SUM(CASE WHEN a.status = 'yes' THEN 1 ELSE 0 END), 0) AS yes_count,
          COALESCE(SUM(CASE WHEN a.status = 'maybe' THEN 1 ELSE 0 END), 0) AS maybe_count
        FROM matches m
        LEFT JOIN availabilities a ON a.match_id = m.id
        GROUP BY m.id
        ORDER BY m.date ASC, m.time ASC
        """
    ).fetchall()

    matches = []
    date_index = {}
    for row in rows:
        item = dict(row)
        item_date = _parse_date(item["date"])
        item["date_obj"] = item_date
        item["yes_count"] = int(item["yes_count"] or 0)
        item["maybe_count"] = int(item["maybe_count"] or 0)
        item["total_players"] = int(total_players)
        item["pct_dispo"] = round((item["yes_count"] / total_players) * 100, 1) if total_players else 0
        item["event_type"] = _event_type_for_row(item)
        item["poll_sent"] = bool(item.get("poll_sent_at"))
        item["format_max"] = format_max_players(item.get("format"))
        matches.append(item)

        if item_date:
            date_key = item_date.isoformat()
            date_index.setdefault(date_key, []).append(item)

    next_match = next(
        (m for m in matches if str(m.get("status") or "").lower() in ("scheduled", "training")),
        None,
    )
    next_match_dispos = next_match["yes_count"] if next_match else 0

    current_month_key = f"{today.year:04d}-{today.month:02d}"
    matches_this_month = sum(1 for m in matches if str(m.get("date", "")).startswith(current_month_key))
    wins = sum(
        1
        for m in matches
        if m.get("score_a") is not None and m.get("score_b") is not None and m["score_a"] > m["score_b"]
    )

    played = [
        m
        for m in sorted(
            (x for x in matches if x.get("score_a") is not None and x.get("score_b") is not None),
            key=lambda item: (item["date"], item["time"]),
            reverse=True,
        )
    ]
    streak = _current_streak(played)

    month_name = month_calendar.month_name[req_month]
    cal = month_calendar.Calendar(firstweekday=0)
    weeks = []
    for week in cal.monthdatescalendar(req_year, req_month):
        week_cells = []
        for day in week:
            iso = day.isoformat()
            day_events = date_index.get(iso, [])
            week_cells.append(
                {
                    "day": day.day,
                    "iso": iso,
                    "in_month": day.month == req_month,
                    "is_today": day == today,
                    "events": day_events,
                    "has_match": any(ev["event_type"] == "match" for ev in day_events),
                    "has_training": any(ev["event_type"] == "training" for ev in day_events),
                    "first_match_id": next((ev["id"] for ev in day_events if ev["event_type"] == "match"), None),
                }
            )
        weeks.append(week_cells)

    prev_month = req_month - 1 or 12
    prev_year = req_year - 1 if req_month == 1 else req_year
    next_month = req_month + 1 if req_month < 12 else 1
    next_year = req_year + 1 if req_month == 12 else req_year

    upcoming_events = [m for m in matches if m["date_obj"] and m["date_obj"] >= today]
    conn.close()

    stats = {
        "next_match": next_match,
        "next_match_dispos": next_match_dispos,
        "total_players": int(total_players),
        "matches_this_month": matches_this_month,
        "wins": wins,
        "current_streak": streak,
    }

    return render_template(
        "calendar.html",
        active_page="cal",
        matches=matches,
        current_month=req_month,
        current_year=req_year,
        month_name=month_name,
        calendar_weeks=weeks,
        upcoming_events=upcoming_events,
        prev_month=prev_month,
        prev_year=prev_year,
        next_month=next_month,
        next_year=next_year,
        stats=stats,
        formats=sorted(VALID_FORMATS),
        admin_token_configured=bool(os.getenv("ADMIN_TOKEN", "").strip()),
        user_is_admin=is_session_admin(),
    )


@calendar_bp.route("/calendrier/add", methods=["POST"])
def add_match():
    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or request.form
    match_date = (payload.get("date") or "").strip()
    match_time = (payload.get("time") or "").strip()
    location = (payload.get("location") or "Terrain habituel").strip() or "Terrain habituel"
    event_kind = (payload.get("event_kind") or "training").strip().lower()
    opponent = (payload.get("opponent") or "").strip() or None
    match_format = (payload.get("format") or "5v5").strip()
    maps_url = (payload.get("maps_url") or "").strip() or None
    notes = (payload.get("notes") or "").strip() or None
    publish_poll = str(payload.get("publish_poll", "")).lower() in ("1", "true", "yes", "on")

    if event_kind not in VALID_EVENT_KINDS:
        return jsonify({"success": False, "error": "invalid event_kind"}), 400
    if match_format not in VALID_FORMATS:
        return jsonify({"success": False, "error": "invalid format"}), 400
    if not match_date or not match_time:
        return jsonify({"success": False, "error": "date and time required"}), 400
    if event_kind == "match" and not opponent:
        return jsonify({"success": False, "error": "opponent required for external match"}), 400

    status = "scheduled" if event_kind == "match" else "training"
    poll_requested_at = datetime.utcnow().isoformat(sep=" ", timespec="seconds") if publish_poll else None

    conn = current_app.get_db_connection()
    cur = conn.execute(
        """
        INSERT INTO matches (
          date, time, location, status, event_kind, opponent, format, maps_url, notes, poll_requested_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            match_date,
            match_time,
            location,
            status,
            event_kind,
            opponent,
            match_format,
            maps_url,
            notes,
            poll_requested_at,
        ),
    )
    conn.commit()
    match_id = cur.lastrowid
    conn.close()

    return jsonify(
        {
            "success": True,
            "match_id": match_id,
            "poll_queued": bool(publish_poll),
        }
    )


@calendar_bp.route("/calendrier/<int:match_id>/poll", methods=["POST"])
def request_poll(match_id):
    denied = admin_guard()
    if denied:
        return denied

    conn = current_app.get_db_connection()
    row = conn.execute("SELECT id, poll_sent_at FROM matches WHERE id = ?", (match_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404
    if row["poll_sent_at"]:
        conn.close()
        return jsonify({"success": False, "error": "poll_already_sent"}), 400

    conn.execute(
        """
        UPDATE matches
        SET poll_requested_at = CURRENT_TIMESTAMP,
            poll_message_id = NULL
        WHERE id = ?
        """,
        (match_id,),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "poll_queued": True})


def _upsert_yes_availabilities(conn, match_id, player_ids):
    for player_id in player_ids:
        conn.execute(
            """
            INSERT INTO availabilities (player_id, match_id, status, responded_at)
            VALUES (?, ?, 'yes', CURRENT_TIMESTAMP)
            ON CONFLICT(player_id, match_id)
            DO UPDATE SET status = 'yes', responded_at = CURRENT_TIMESTAMP
            """,
            (int(player_id), match_id),
        )


@calendar_bp.route("/calendrier/<int:match_id>/lineup/generate", methods=["POST"])
def generate_lineup(match_id):
    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or {}
    color_a = (payload.get("color_a") or "Rouge").strip()
    color_b = (payload.get("color_b") or "Vert").strip()

    conn = current_app.get_db_connection()
    match = conn.execute("SELECT id FROM matches WHERE id = ?", (match_id,)).fetchone()
    if not match:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404

    match_row = conn.execute("SELECT format FROM matches WHERE id = ?", (match_id,)).fetchone()
    format_max = format_max_players(match_row["format"] if match_row else None)
    team_max = (format_max // 2) if format_max else None

    team_a_raw = payload.get("team_a_ids")
    team_b_raw = payload.get("team_b_ids")

    if isinstance(team_a_raw, list) and isinstance(team_b_raw, list):
        team_a_ids = [int(pid) for pid in team_a_raw]
        team_b_ids = [int(pid) for pid in team_b_raw]
        overlap = set(team_a_ids) & set(team_b_ids)
        if overlap:
            conn.close()
            return jsonify({"success": False, "error": "player_in_both_teams"}), 400
        total = len(team_a_ids) + len(team_b_ids)
        if not total:
            conn.close()
            return jsonify({"success": False, "error": "empty_teams"}), 400
        if format_max and total > format_max:
            conn.close()
            return jsonify(
                {"success": False, "error": "too_many_players", "format_max": format_max},
                400,
            )
        if team_max and (len(team_a_ids) > team_max or len(team_b_ids) > team_max):
            conn.close()
            return jsonify(
                {"success": False, "error": "team_too_large", "team_max": team_max},
                400,
            )

        _upsert_yes_availabilities(conn, match_id, team_a_ids + team_b_ids)
        reserve_count = 0
    else:
        yes_rows = conn.execute(
            """
            SELECT p.id, p.name
            FROM availabilities a
            JOIN players p ON p.id = a.player_id
            WHERE a.match_id = ?
              AND a.status = 'yes'
              AND p.active = 1
            ORDER BY a.responded_at ASC, p.name ASC
            """,
            (match_id,),
        ).fetchall()

        if not yes_rows:
            conn.close()
            return jsonify({"success": False, "error": "no_available_players"}), 400

        all_yes = [dict(row) for row in yes_rows]
        format_max = format_max or len(all_yes)
        players = list(all_yes)
        selected_ids = payload.get("player_ids")
        if isinstance(selected_ids, list) and selected_ids:
            allowed = {int(pid) for pid in selected_ids}
            players = [p for p in players if p["id"] in allowed]
            if not players:
                conn.close()
                return jsonify({"success": False, "error": "invalid_player_selection"}), 400
            if len(players) > format_max:
                conn.close()
                return jsonify(
                    {"success": False, "error": "too_many_players", "format_max": format_max},
                    400,
                )

        random.shuffle(players)
        players = players[:format_max]
        split_index = max(1, len(players) // 2) if len(players) > 1 else 1
        team_a_ids = [p["id"] for p in players[:split_index]]
        team_b_ids = [p["id"] for p in players[split_index:]]
        reserve_count = max(0, len(all_yes) - len(players))

    existing = conn.execute("SELECT id FROM lineups WHERE match_id = ?", (match_id,)).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE lineups
            SET team_a = ?, team_b = ?, color_a = ?, color_b = ?
            WHERE match_id = ?
            """,
            (json.dumps(team_a_ids), json.dumps(team_b_ids), color_a, color_b, match_id),
        )
    else:
        conn.execute(
            """
            INSERT INTO lineups (match_id, team_a, team_b, color_a, color_b)
            VALUES (?, ?, ?, ?, ?)
            """,
            (match_id, json.dumps(team_a_ids), json.dumps(team_b_ids), color_a, color_b),
        )

    conn.commit()
    conn.close()
    return jsonify(
        {
            "success": True,
            "team_a_count": len(team_a_ids),
            "team_b_count": len(team_b_ids),
            "color_a": color_a,
            "color_b": color_b,
            "format_max": format_max,
            "selected_count": len(team_a_ids) + len(team_b_ids),
            "reserve_count": reserve_count,
        }
    )


@calendar_bp.route("/calendrier/<int:match_id>/lineup/players", methods=["GET"])
def lineup_players(match_id):
    denied = admin_guard()
    if denied:
        return denied

    conn = current_app.get_db_connection()
    match = conn.execute("SELECT id, format FROM matches WHERE id = ?", (match_id,)).fetchone()
    if not match:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404

    yes_rows = conn.execute(
        """
        SELECT p.id, p.name
        FROM availabilities a
        JOIN players p ON p.id = a.player_id
        WHERE a.match_id = ?
          AND a.status = 'yes'
          AND p.active = 1
        ORDER BY a.responded_at ASC, p.name ASC
        """,
        (match_id,),
    ).fetchall()

    all_rows = conn.execute(
        """
        SELECT id, name
        FROM players
        WHERE active = 1
        ORDER BY name ASC
        """
    ).fetchall()

    lineup = conn.execute(
        "SELECT team_a, team_b, color_a, color_b FROM lineups WHERE match_id = ?",
        (match_id,),
    ).fetchone()
    conn.close()

    format_max = format_max_players(match["format"])
    team_max = (format_max // 2) if format_max else None
    yes_players = [dict(row) for row in yes_rows]
    all_players = [dict(row) for row in all_rows]

    if yes_players:
        pool = yes_players
        source = "yes_votes"
    else:
        pool = all_players
        source = "all_players"

    team_a_ids = []
    team_b_ids = []
    color_a = "Rouge"
    color_b = "Vert"
    if lineup:
        team_a_ids = json.loads(lineup["team_a"] or "[]")
        team_b_ids = json.loads(lineup["team_b"] or "[]")
        color_a = lineup["color_a"] or color_a
        color_b = lineup["color_b"] or color_b

    return jsonify(
        {
            "success": True,
            "format": match["format"],
            "format_max": format_max,
            "team_max": team_max,
            "source": source,
            "pool_players": pool,
            "yes_count": len(yes_players),
            "team_a_ids": team_a_ids,
            "team_b_ids": team_b_ids,
            "color_a": color_a,
            "color_b": color_b,
            "lineup": dict(lineup) if lineup else None,
        }
    )


@calendar_bp.route("/calendrier/<int:match_id>/lineup/notify", methods=["POST"])
def request_lineup_notify(match_id):
    denied = admin_guard()
    if denied:
        return denied

    conn = current_app.get_db_connection()
    match = conn.execute("SELECT id FROM matches WHERE id = ?", (match_id,)).fetchone()
    lineup = conn.execute("SELECT id FROM lineups WHERE match_id = ?", (match_id,)).fetchone()
    if not match:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404
    if not lineup:
        conn.close()
        return jsonify({"success": False, "error": "lineup_missing"}), 400

    payload = request.get_json(silent=True) or {}
    force = str(payload.get("force", "")).lower() in ("1", "true", "yes", "on")

    conn.execute(
        """
        UPDATE matches
        SET lineup_notify_requested_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (match_id,),
    )
    if force:
        conn.execute(
            "UPDATE matches SET lineup_notified_at = NULL WHERE id = ?",
            (match_id,),
        )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "notify_queued": True, "force": force})


@calendar_bp.route("/calendrier/<int:match_id>", methods=["PUT"])
def update_match(match_id):
    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or {}
    conn = current_app.get_db_connection()
    match = conn.execute("SELECT id FROM matches WHERE id = ?", (match_id,)).fetchone()
    if not match:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404

    fields = []
    values = []
    mapping = {
        "date": "date",
        "time": "time",
        "location": "location",
        "maps_url": "maps_url",
        "notes": "notes",
        "format": "format",
        "event_kind": "event_kind",
        "opponent": "opponent",
        "status": "status",
    }

    for key, column in mapping.items():
        if key in payload:
            fields.append(f"{column} = ?")
            values.append(payload.get(key))

    if not fields:
        conn.close()
        return jsonify({"success": False, "error": "no_fields"}), 400

    values.append(match_id)
    conn.execute(f"UPDATE matches SET {', '.join(fields)} WHERE id = ?", tuple(values))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


def _clear_poll_in_db(conn, match_id, keep_message_id_for_bot=False):
    if keep_message_id_for_bot:
        conn.execute(
            """
            UPDATE matches
            SET poll_sent_at = NULL,
                poll_requested_at = NULL,
                poll_republish_requested_at = NULL,
                poll_delete_requested_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (match_id,),
        )
        return

    conn.execute(
        """
        UPDATE matches
        SET poll_message_id = NULL,
            poll_sent_at = NULL,
            poll_requested_at = NULL,
            poll_delete_requested_at = NULL,
            poll_republish_requested_at = NULL
        WHERE id = ?
        """,
        (match_id,),
    )


def _delete_match_cascade(conn, match_id):
    conn.execute("DELETE FROM availabilities WHERE match_id = ?", (match_id,))
    conn.execute("DELETE FROM lineups WHERE match_id = ?", (match_id,))
    try:
        conn.execute("DELETE FROM match_media WHERE match_id = ?", (match_id,))
    except Exception:
        pass
    conn.execute("DELETE FROM matches WHERE id = ?", (match_id,))


@calendar_bp.route("/calendrier/<int:match_id>/poll/delete", methods=["POST"])
def request_poll_delete(match_id):
    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or {}
    local_only = str(payload.get("local_only", "")).lower() in ("1", "true", "yes", "on")

    conn = current_app.get_db_connection()
    match = conn.execute(
        "SELECT id, poll_message_id FROM matches WHERE id = ?",
        (match_id,),
    ).fetchone()
    if not match:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404

    had_whatsapp_poll = bool(match["poll_message_id"])
    if local_only or not had_whatsapp_poll:
        _clear_poll_in_db(conn, match_id, keep_message_id_for_bot=False)
        conn.commit()
        conn.close()
        return jsonify(
            {
                "success": True,
                "cleared_local": True,
                "whatsapp_queued": False,
                "message": "Sondage retire du calendrier (base de donnees).",
            }
        )

    _clear_poll_in_db(conn, match_id, keep_message_id_for_bot=True)
    conn.commit()
    conn.close()
    return jsonify(
        {
            "success": True,
            "cleared_local": True,
            "whatsapp_queued": True,
            "message": "Calendrier mis a jour. Le bot supprimera le message WhatsApp a la reconnexion.",
        }
    )


@calendar_bp.route("/calendrier/<int:match_id>", methods=["DELETE"])
def delete_match(match_id):
    denied = admin_guard()
    if denied:
        return denied

    conn = current_app.get_db_connection()
    match = conn.execute("SELECT id FROM matches WHERE id = ?", (match_id,)).fetchone()
    if not match:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404

    _delete_match_cascade(conn, match_id)
    conn.commit()
    conn.close()
    return jsonify(
        {
            "success": True,
            "message": "Evenement supprime du calendrier.",
        }
    )


@calendar_bp.route("/calendrier/<int:match_id>/poll/republish", methods=["POST"])
def request_poll_republish(match_id):
    denied = admin_guard()
    if denied:
        return denied

    conn = current_app.get_db_connection()
    match = conn.execute("SELECT id FROM matches WHERE id = ?", (match_id,)).fetchone()
    if not match:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404

    conn.execute(
        """
        UPDATE matches
        SET poll_republish_requested_at = CURRENT_TIMESTAMP,
            poll_requested_at = NULL
        WHERE id = ?
        """,
        (match_id,),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "republish_queued": True})
