import os
import uuid
from pathlib import Path

from PIL import Image
from flask import Blueprint, current_app, jsonify, render_template, request, url_for

from auth_utils import is_session_admin
from werkzeug.utils import secure_filename


history_bp = Blueprint("history", __name__, url_prefix="/")


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov"}


def _parse_lineup_ids(lineup_row):
    import json

    try:
        team_a_ids = json.loads(lineup_row["team_a"] or "[]")
    except Exception:
        team_a_ids = []
    try:
        team_b_ids = json.loads(lineup_row["team_b"] or "[]")
    except Exception:
        team_b_ids = []
    return team_a_ids, team_b_ids


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
    placeholders = ",".join(["?"] * len(ids))
    rows = conn.execute(
        f"SELECT id, name FROM players WHERE id IN ({placeholders})",
        ids
    ).fetchall()
    by_id = {row["id"]: row["name"] for row in rows}
    roles = _roles_for_size(len(ids))
    return [
        {"id": pid, "name": by_id.get(pid, f"Joueur#{pid}"), "position": roles[idx] if idx < len(roles) else "SUB"}
        for idx, pid in enumerate(ids)
    ]


def _result_from_score(score_a, score_b):
    if score_a is None or score_b is None:
        return "draw"
    if score_a > score_b:
        return "win"
    if score_a < score_b:
        return "loss"
    return "draw"


@history_bp.route("/matchs", methods=["GET"])
def history_page():
    requested_filter = (request.args.get("filter", "all") or "all").lower()
    if requested_filter not in {"all", "win", "loss", "draw"}:
        requested_filter = "all"

    conn = current_app.get_db_connection()
    match_rows = conn.execute(
        """
        SELECT
          m.id,
          m.date,
          m.time,
          m.location,
          m.status,
          m.score_a,
          m.score_b,
          m.notes,
          m.homme_du_match,
          (
            SELECT json_object(
              'id', l.id,
              'team_a', l.team_a,
              'team_b', l.team_b,
              'color_a', l.color_a,
              'color_b', l.color_b,
              'created_at', l.created_at
            )
            FROM lineups l
            WHERE l.match_id = m.id
            ORDER BY datetime(l.created_at) DESC, l.id DESC
            LIMIT 1
          ) AS lineup_json,
          (
            SELECT COUNT(*)
            FROM match_media mm
            WHERE mm.match_id = m.id AND mm.type = 'image'
          ) AS photos_count
        FROM matches m
        WHERE m.status = 'done'
        ORDER BY m.date DESC, m.time DESC
        """
    ).fetchall()

    import json

    matches = []
    for row in match_rows:
        match = dict(row)
        match["result"] = _result_from_score(match["score_a"], match["score_b"])
        lineup_json = match.get("lineup_json")
        match["lineup"] = json.loads(lineup_json) if lineup_json else None
        match["photos_count"] = int(match.get("photos_count") or 0)
        matches.append(match)

    if requested_filter != "all":
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
    )


@history_bp.route("/match/<int:match_id>", methods=["GET"])
def match_detail(match_id):
    conn = current_app.get_db_connection()

    match = conn.execute(
        """
        SELECT id, date, time, location, status, score_a, score_b, notes, homme_du_match
        FROM matches
        WHERE id = ?
        """,
        (match_id,)
    ).fetchone()
    if not match:
        conn.close()
        return jsonify({"success": False, "error": "match_not_found"}), 404

    lineup_row = conn.execute(
        """
        SELECT id, team_a, team_b, color_a, color_b, created_at
        FROM lineups
        WHERE match_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
        """,
        (match_id,)
    ).fetchone()

    lineup = None
    if lineup_row:
        team_a_ids, team_b_ids = _parse_lineup_ids(lineup_row)
        lineup = {
            "id": lineup_row["id"],
            "color_a": lineup_row["color_a"],
            "color_b": lineup_row["color_b"],
            "team_a": _load_players_by_ids(conn, team_a_ids),
            "team_b": _load_players_by_ids(conn, team_b_ids),
        }

    availability_rows = conn.execute(
        """
        SELECT p.name, COALESCE(a.status, 'pending') AS status
        FROM players p
        LEFT JOIN availabilities a
          ON a.player_id = p.id
         AND a.match_id = ?
        WHERE p.active = 1
        ORDER BY p.name ASC
        """,
        (match_id,)
    ).fetchall()

    availability = {"yes": [], "no": [], "maybe": [], "pending": []}
    for row in availability_rows:
        key = row["status"] if row["status"] in availability else "pending"
        availability[key].append(row["name"])

    media_rows = conn.execute(
        """
        SELECT id, filename, type, caption, created_at
        FROM match_media
        WHERE match_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        """,
        (match_id,)
    ).fetchall()

    media = []
    for row in media_rows:
        media.append(
            {
                "id": row["id"],
                "filename": row["filename"],
                "type": row["type"],
                "caption": row["caption"],
                "url": url_for("static", filename=f"uploads/matches/{match_id}/{row['filename']}")
            }
        )

    conn.close()

    return jsonify(
        {
            "success": True,
            "match": dict(match),
            "lineup": lineup,
            "availability": availability,
            "media": media
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
    caption = (request.form.get("caption") or "").strip()
    if not uploaded or not uploaded.filename:
        return jsonify({"success": False, "error": "file_invalid"}), 400

    ext = Path(uploaded.filename).suffix.lower()
    media_type = None
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
        (match_id, media_type, output_name, caption, request.headers.get("X-User-Phone"))
    )
    conn.commit()
    conn.close()

    return jsonify(
        {
            "success": True,
            "id": cur.lastrowid,
            "filename": output_name,
            "url": url_for("static", filename=f"uploads/matches/{match_id}/{output_name}")
        }
    )


@history_bp.route("/match/<int:match_id>/score", methods=["POST"])
def update_match_score(match_id):
    from routes.admin_utils import admin_guard

    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or {}
    score_a = payload.get("score_a")
    score_b = payload.get("score_b")
    notes = payload.get("notes")
    homme_du_match = payload.get("homme_du_match")

    if score_a is None or score_b is None:
        return jsonify({"success": False, "error": "scores_required"}), 400

    conn = current_app.get_db_connection()
    conn.execute(
        """
        UPDATE matches
        SET score_a = ?, score_b = ?, notes = ?, homme_du_match = ?, status = 'done'
        WHERE id = ?
        """,
        (int(score_a), int(score_b), notes, homme_du_match, match_id)
    )
    conn.commit()
    conn.close()

    return jsonify({"success": True, "match_id": match_id})
