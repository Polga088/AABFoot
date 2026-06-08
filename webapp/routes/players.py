import os

from flask import Blueprint, current_app, jsonify, render_template, request

from auth_utils import admin_page_required
from player_utils import apply_id_label, player_id_label
from routes.admin_utils import admin_guard, normalize_phone


players_bp = Blueprint("players", __name__, url_prefix="/")


def _fetch_players(conn, include_inactive=False):
    query = """
        SELECT
          p.id,
          p.first_name,
          p.last_name,
          p.name,
          p.display_name,
          p.phone,
          p.role,
          p.active,
          COALESCE(w.balance, 0) AS balance
        FROM players p
        LEFT JOIN wallets w ON w.player_id = p.id
    """
    if not include_inactive:
        query += " WHERE p.active = 1"
    query += " ORDER BY p.active DESC, p.id ASC"
    return conn.execute(query).fetchall()


@players_bp.route("/joueurs", methods=["GET"])
@admin_page_required
def players_page():
    include_inactive = request.args.get("show_inactive") == "1"
    conn = current_app.get_db_connection()
    rows = _fetch_players(conn, include_inactive=include_inactive)
    conn.close()

    players = []
    for row in rows:
        item = dict(row)
        item["balance"] = round(float(item["balance"] or 0), 2)
        item["active"] = bool(item["active"])
        players.append(item)

    return render_template(
        "players.html",
        active_page="players",
        players=players,
        show_inactive=include_inactive,
        admin_token_configured=bool(os.getenv("ADMIN_TOKEN", "").strip()),
    )


@players_bp.route("/joueurs", methods=["POST"])
def create_player():
    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or request.form
    phone = normalize_phone(payload.get("phone"))
    initial_balance = float(payload.get("initial_balance") or 0)

    if not phone:
        return jsonify({"success": False, "error": "Telephone obligatoire"}), 400

    conn = current_app.get_db_connection()
    exists = conn.execute("SELECT id FROM players WHERE phone = ?", (phone,)).fetchone()
    if exists:
        conn.close()
        return jsonify({"success": False, "error": "Ce numero existe deja"}), 409

    cur = conn.execute(
        """
        INSERT INTO players (name, first_name, last_name, phone, role, active)
        VALUES (?, '', '', ?, 'player', 1)
        """,
        ("-", phone),
    )
    player_id = cur.lastrowid
    apply_id_label(conn, player_id)
    conn.execute(
        "INSERT INTO wallets (player_id, balance, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        (player_id, initial_balance),
    )
    if initial_balance > 0:
        conn.execute(
            """
            INSERT INTO transactions (player_id, amount, type, description)
            VALUES (?, ?, 'credit', 'Solde initial')
            """,
            (player_id, initial_balance),
        )
    conn.commit()
    conn.close()

    return jsonify({"success": True, "player_id": player_id, "label": player_id_label(player_id)})


@players_bp.route("/joueurs/<int:player_id>", methods=["PUT"])
def update_player(player_id):
    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or {}
    phone_raw = payload.get("phone")
    phone = normalize_phone(phone_raw) if phone_raw else None
    active = payload.get("active")
    display_name_raw = payload.get("display_name")

    if not phone:
        return jsonify({"success": False, "error": "Telephone obligatoire"}), 400

    conn = current_app.get_db_connection()
    player = conn.execute("SELECT id FROM players WHERE id = ?", (player_id,)).fetchone()
    if not player:
        conn.close()
        return jsonify({"success": False, "error": "Joueur introuvable"}), 404

    if phone:
        other = conn.execute(
            "SELECT id FROM players WHERE phone = ? AND id != ?",
            (phone, player_id),
        ).fetchone()
        if other:
            conn.close()
            return jsonify({"success": False, "error": "Ce numero existe deja"}), 409

    active_value = 1 if active is not False else 0
    display_name = None
    if display_name_raw is not None:
        display_name = (str(display_name_raw).strip() or None)

    conn.execute(
        "UPDATE players SET phone = ?, active = ?, display_name = ? WHERE id = ?",
        (phone, active_value, display_name, player_id),
    )
    apply_id_label(conn, player_id)

    conn.commit()
    conn.close()
    return jsonify({"success": True})


def _hard_delete_player(conn, player_id):
    conn.execute("DELETE FROM availabilities WHERE player_id = ?", (player_id,))
    conn.execute("DELETE FROM transactions WHERE player_id = ?", (player_id,))
    conn.execute("DELETE FROM wallets WHERE player_id = ?", (player_id,))
    conn.execute("DELETE FROM players WHERE id = ?", (player_id,))


@players_bp.route("/joueurs/<int:player_id>", methods=["DELETE"])
def delete_player(player_id):
    denied = admin_guard()
    if denied:
        return denied

    permanent = request.args.get("permanent") == "1" or request.args.get("hard") == "1"

    conn = current_app.get_db_connection()
    player = conn.execute(
        "SELECT id, role, active FROM players WHERE id = ?", (player_id,)
    ).fetchone()
    if not player:
        conn.close()
        return jsonify({"success": False, "error": "Joueur introuvable"}), 404

    if player["role"] == "admin":
        conn.close()
        return jsonify({"success": False, "error": "Impossible de supprimer un admin"}), 400

    if permanent:
        _hard_delete_player(conn, player_id)
        message = "Joueur supprime definitivement"
    else:
        conn.execute("UPDATE players SET active = 0 WHERE id = ?", (player_id,))
        message = "Joueur desactive"

    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": message, "permanent": permanent})


@players_bp.route("/joueurs/<int:player_id>/reset-pin", methods=["POST"])
def reset_player_pin(player_id):
    denied = admin_guard()
    if denied:
        return denied

    conn = current_app.get_db_connection()
    updated = conn.execute(
        "UPDATE players SET password_hash = NULL WHERE id = ?",
        (player_id,),
    ).rowcount
    conn.commit()
    conn.close()
    if not updated:
        return jsonify({"success": False, "error": "Joueur introuvable"}), 404
    return jsonify({"success": True, "message": "Code PIN reinitialise. Le joueur devra en creer un a la prochaine connexion."})


@players_bp.route("/joueurs/<int:player_id>/reactivate", methods=["POST"])
def reactivate_player(player_id):
    denied = admin_guard()
    if denied:
        return denied

    conn = current_app.get_db_connection()
    conn.execute("UPDATE players SET active = 1 WHERE id = ?", (player_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})
