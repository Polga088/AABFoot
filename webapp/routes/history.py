import json
import os
import uuid
from pathlib import Path

from flask import Blueprint, current_app, jsonify, render_template, request, session, url_for
from PIL import Image
from werkzeug.utils import secure_filename

from auth_utils import is_session_admin, login_required
from match_stats_db import (
    ensure_match_stats_tables,
    fetch_match_goals,
    fetch_motm_tally,
    lineup_player_ids,
    load_players_map,
    parse_lineup_ids,
    replace_match_goals,
    sync_motm_winner,
)
from player_utils import player_id_label


history_bp = Blueprint("history", __name__, url_prefix="/")

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov"}


def _roles_for_size(size):
    if size >= 5:
        return ["GK", "DEF", "DEF", "MID", "ATT"]
    if size == 4:
        return ["GK", "DEF", "MID", "ATT"]
    if size == 3:
        return ["GK", "DEF", "ATT"]
    if size == 2:
        return ["DEF", "ATT"]
    return ["ATT"]


def _load_players_by_ids(conn, ids):
    if not ids:
        return []
    names = load_players_map(conn, ids)
    roles = _roles_for_size(len(ids))
    return [
        {
            "id": pid,
            "name": names.get(pid, player_id_label(pid)),
            "position": roles[idx] if idx < len(roles) else "SUB",
        }
        for idx, pid in enumerate(ids)
    ]


def _result_from_score(score_a, score_b):
    if score_a is None or score_b is None:
        return None
    if score_a > score_b:
        return "win"
    if score_a < score_b:
        return "loss"
    return "draw"


def _match_title(row):
    if str(row.get("event_kind") or "") == "match" and row.get("opponent"):
        return f"Match vs {row['opponent']}"
    fmt = row.get("format") or "5v5"
    return f"Entraînement {fmt}"


@history_bp.route("/matchs", methods=["GET"])
@login_required
def history_page():
    requested_filter = (request.args.get("filter", "all") or "all").lower()
    valid = {"all", "pending", "done", "win", "loss", "draw"}
    if requested_filter not in valid:
        requested_filter = "all"

    conn = current_app.get_db_connection()
    ensure_match_stats_tables(conn)

    match_rows = conn.execute(
        """
        SELECT
          m.id, m.date, m.time, m.location, m.status, m.event_kind, m.opponent, m.format,
          m.score_a, m.score_b, m.notes, m.homme_du_match, m.motm_player_id,
          (SELECT COUNT(*) FROM match_goals g WHERE g.match_id = m.id) AS goals_count,
          (SELECT COUNT(*) FROM match_media mm WHERE mm.match_id = m.id AND mm.type = 'image') AS photos_count
        FROM matches m
        WHERE EXISTS (SELECT 1 FROM lineups l WHERE l.match_id = m.id)
        ORDER BY m.date DESC, m.time DESC, m.id DESC
        """
    ).fetchall()

    matches = []
    for row in match_rows:
        item = dict(row)
        item["title"] = _match_title(item)
        item["result"] = _result_from_score(item["score_a"], item["score_b"])
        item["is_done"] = item["status"] == "done" and item["score_a"] is not None
        item["is_pending"] = not item["is_done"]
        matches.append(item)

    if requested_filter == "pending":
        matches = [m for m in matches if m["is_pending"]]
    elif requested_filter == "done":
        matches = [m for m in matches if m["is_done"]]
    elif requested_filter in {"win", "loss", "draw"}:
        matches = [m for m in matches if m["result"] == requested_filter]

    selected_match = matches[0] if matches else None
    conn.close()

    return render_template(
        "history.html",
        active_page="hist",
        matches=matches,
        selected_match=selected_match,
        filter=requested_filter,
        user_is_admin=is_session_admin(),
        current_player_id=session.get("player_id"),
    )


@history_bp.route("/match/<int:match_id>", methods=["GET"])
@login_required
def match_detail(match_id):
    conn = current_app.get_db_connection()
    ensure_match_stats_tables(conn)

    match = conn.execute(
        """
        SELECT id, date, time, location, status, event_kind, opponent, format,
               score_a, score_b, notes, homme_du_match, motm_player_id
        FROM matches WHERE id = ?
        """,
        (match_id,),
    ).fetchone()
    if not match:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404

    match_dict = dict(match)
    match_dict["title"] = _match_title(match_dict)

    lineup_row = conn.execute(
        """
        SELECT id, team_a, team_b, color_a, color_b, created_at
        FROM lineups WHERE match_id = ?
        ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
        """,
        (match_id,),
    ).fetchone()

    lineup = None
    lineup_players = []
    if lineup_row:
        team_a_ids, team_b_ids = parse_lineup_ids(lineup_row)
        lineup = {
            "id": lineup_row["id"],
            "color_a": lineup_row["color_a"],
            "color_b": lineup_row["color_b"],
            "team_a": _load_players_by_ids(conn, team_a_ids),
            "team_b": _load_players_by_ids(conn, team_b_ids),
        }
        lineup_players = lineup["team_a"] + lineup["team_b"]

    goals = fetch_match_goals(conn, match_id)
    motm_tally = fetch_motm_tally(conn, match_id)

    voter_id = session.get("player_id")
    user_vote = None
    can_vote = False
    if voter_id and lineup_player_ids(conn, match_id):
        can_vote = int(voter_id) in lineup_player_ids(conn, match_id)
        vote_row = conn.execute(
            """
            SELECT voted_player_id FROM match_motm_votes
            WHERE match_id = ? AND voter_player_id = ?
            """,
            (match_id, voter_id),
        ).fetchone()
        if vote_row:
            user_vote = vote_row["voted_player_id"]

    media_rows = conn.execute(
        """
        SELECT id, filename, type, caption, created_at
        FROM match_media WHERE match_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        """,
        (match_id,),
    ).fetchall()

    media = [
        {
            "id": row["id"],
            "filename": row["filename"],
            "type": row["type"],
            "caption": row["caption"],
            "url": url_for("static", filename=f"uploads/matches/{match_id}/{row['filename']}"),
        }
        for row in media_rows
    ]

    conn.close()

    return jsonify(
        {
            "success": True,
            "match": match_dict,
            "lineup": lineup,
            "lineup_players": lineup_players,
            "goals": goals,
            "motm_tally": motm_tally,
            "can_vote_motm": can_vote,
            "user_motm_vote": user_vote,
            "media": media,
            "is_admin": is_session_admin(),
        }
    )


@history_bp.route("/match/<int:match_id>/result", methods=["POST"])
def save_match_result(match_id):
    from routes.admin_utils import admin_guard

    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or {}
    score_a = payload.get("score_a")
    score_b = payload.get("score_b")
    if score_a is None or score_b is None:
        return jsonify({"success": False, "error": "scores_required"}), 400

    goals = payload.get("goals") or []
    notes = (payload.get("notes") or "").strip() or None
    motm_player_id = payload.get("motm_player_id")

    conn = current_app.get_db_connection()
    ensure_match_stats_tables(conn)

    lineup_ids = lineup_player_ids(conn, match_id)
    if not lineup_ids:
        conn.close()
        return jsonify({"success": False, "error": "lineup_missing"}), 400

    replace_match_goals(conn, match_id, goals)

    motm_name = None
    if motm_player_id:
        row = conn.execute("SELECT name FROM players WHERE id = ?", (int(motm_player_id),)).fetchone()
        motm_name = row["name"] if row else player_id_label(int(motm_player_id))

    conn.execute(
        """
        UPDATE matches
        SET score_a = ?, score_b = ?, notes = ?, status = 'done',
            motm_player_id = ?, homme_du_match = COALESCE(?, homme_du_match)
        WHERE id = ?
        """,
        (
            int(score_a),
            int(score_b),
            notes,
            int(motm_player_id) if motm_player_id else None,
            motm_name,
            match_id,
        ),
    )

    if not motm_player_id:
        winner = sync_motm_winner(conn, match_id)
        if winner:
            motm_name = winner["name"]

    conn.commit()
    conn.close()

    return jsonify({"success": True, "match_id": match_id, "homme_du_match": motm_name})


@history_bp.route("/match/<int:match_id>/motm/vote", methods=["POST"])
@login_required
def vote_motm(match_id):
    payload = request.get_json(silent=True) or {}
    voted_player_id = payload.get("player_id")
    voter_id = session.get("player_id")

    if not voter_id:
        return jsonify({"success": False, "error": "not_authenticated"}), 401
    if not voted_player_id:
        return jsonify({"success": False, "error": "player_required"}), 400

    conn = current_app.get_db_connection()
    ensure_match_stats_tables(conn)

    allowed = lineup_player_ids(conn, match_id)
    if int(voter_id) not in allowed:
        conn.close()
        return jsonify({"success": False, "error": "not_in_lineup"}), 403
    if int(voted_player_id) not in allowed:
        conn.close()
        return jsonify({"success": False, "error": "invalid_player"}), 400

    conn.execute(
        """
        INSERT INTO match_motm_votes (match_id, voter_player_id, voted_player_id)
        VALUES (?, ?, ?)
        ON CONFLICT(match_id, voter_player_id)
        DO UPDATE SET voted_player_id = excluded.voted_player_id,
                      created_at = CURRENT_TIMESTAMP
        """,
        (match_id, voter_id, int(voted_player_id)),
    )
    winner = sync_motm_winner(conn, match_id)
    tally = fetch_motm_tally(conn, match_id)
    conn.commit()
    conn.close()

    return jsonify(
        {
            "success": True,
            "motm_tally": tally,
            "winner": winner,
        }
    )


@history_bp.route("/match/<int:match_id>/upload", methods=["POST"])
def upload_match_media(match_id):
    from routes.admin_utils import admin_guard

    denied = admin_guard()
    if denied:
        return denied

    if "file" not in request.files:
        return jsonify({"success": False, "error": "file_missing"}), 400

    uploaded = request.files["file"]
    if not uploaded or not uploaded.filename:
        return jsonify({"success": False, "error": "file_invalid"}), 400

    ext = Path(uploaded.filename).suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        media_type = "image"
    elif ext in VIDEO_EXTENSIONS:
        media_type = "video"
    else:
        return jsonify({"success": False, "error": "unsupported_file_type"}), 400

    upload_root = current_app.config["UPLOAD_FOLDER"]
    match_dir = os.path.join(upload_root, str(match_id))
    os.makedirs(match_dir, exist_ok=True)

    safe_stem = secure_filename(Path(uploaded.filename).stem) or "media"
    unique_name = f"{safe_stem}_{uuid.uuid4().hex[:10]}"

    if media_type == "image":
        output_name = f"{unique_name}.jpg"
        output_path = os.path.join(match_dir, output_name)
        image = Image.open(uploaded.stream)
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        elif image.mode == "L":
            image = image.convert("RGB")
        image.thumbnail((1200, 1200))
        image.save(output_path, format="JPEG", quality=85, optimize=True)
    else:
        output_name = f"{unique_name}{ext}"
        output_path = os.path.join(match_dir, output_name)
        uploaded.save(output_path)

    conn = current_app.get_db_connection()
    cur = conn.execute(
        """
        INSERT INTO match_media (match_id, type, filename, caption, uploaded_by)
        VALUES (?, ?, ?, ?, ?)
        """,
        (match_id, media_type, output_name, "", request.headers.get("X-User-Phone")),
    )
    conn.commit()
    conn.close()

    return jsonify(
        {
            "success": True,
            "id": cur.lastrowid,
            "filename": output_name,
            "url": url_for("static", filename=f"uploads/matches/{match_id}/{output_name}"),
        }
    )


@history_bp.route("/match/<int:match_id>/score", methods=["POST"])
def update_match_score(match_id):
    """Compatibilité ancienne API — redirige vers /result."""
    return save_match_result(match_id)
