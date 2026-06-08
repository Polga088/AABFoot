import csv
import io
import os
from datetime import datetime

from flask import Blueprint, Response, current_app, jsonify, render_template, request

from auth_utils import admin_page_required
from player_utils import apply_id_label, get_default_cotisation, player_cotisation_amount, player_public_label
from routes.admin_utils import admin_guard, normalize_phone


finance_bp = Blueprint("finance", __name__, url_prefix="/")


@finance_bp.route("/finance", methods=["GET"])
@admin_page_required
def finance_page():
    conn = current_app.get_db_connection()
    players = conn.execute(
        """
        SELECT
          p.id,
          p.first_name,
          p.last_name,
          p.name,
          p.display_name,
          p.phone,
          p.cotisation_amount,
          p.active,
          COALESCE(w.balance, 0) AS balance
        FROM players p
        LEFT JOIN wallets w ON w.player_id = p.id
        ORDER BY p.id ASC
        """
    ).fetchall()

    transactions = conn.execute(
        """
        SELECT
          t.id,
          t.amount,
          t.type,
          t.description,
          t.created_at,
          p.id AS player_ref_id,
          p.phone
        FROM transactions t
        JOIN players p ON p.id = t.player_id
        ORDER BY datetime(t.created_at) DESC, t.id DESC
        LIMIT 200
        """
    ).fetchall()
    default_cotisation = get_default_cotisation()
    player_rows = []
    for row in players:
        item = dict(row)
        item["label"] = player_public_label(item, is_admin=True)
        item["cotisation"] = player_cotisation_amount(item, default_cotisation)
        item["balance"] = round(float(item["balance"] or 0), 2)
        player_rows.append(item)

    conn.close()

    return render_template(
        "finance.html",
        active_page="finance",
        players=player_rows,
        transactions=[dict(row) for row in transactions],
        cotisation_amount=default_cotisation,
        admin_token_configured=bool(os.getenv("ADMIN_TOKEN", "").strip()),
    )


@finance_bp.route("/finance/players/<int:player_id>/cotisation", methods=["PUT"])
def update_player_cotisation(player_id):
    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or {}
    raw_amount = payload.get("cotisation_amount")

    conn = current_app.get_db_connection()
    player = conn.execute("SELECT id FROM players WHERE id = ?", (player_id,)).fetchone()
    if not player:
        conn.close()
        return jsonify({"success": False, "error": "player_not_found"}), 404

    if raw_amount is None or raw_amount == "":
        conn.execute("UPDATE players SET cotisation_amount = NULL WHERE id = ?", (player_id,))
        effective = get_default_cotisation()
    else:
        try:
            amount = float(raw_amount)
        except (TypeError, ValueError):
            conn.close()
            return jsonify({"success": False, "error": "invalid_amount"}), 400
        if amount <= 0:
            conn.close()
            return jsonify({"success": False, "error": "invalid_amount"}), 400
        conn.execute(
            "UPDATE players SET cotisation_amount = ? WHERE id = ?",
            (amount, player_id),
        )
        effective = amount

    conn.commit()
    conn.close()
    return jsonify({"success": True, "cotisation_amount": round(effective, 2)})


@finance_bp.route("/finance/credit", methods=["POST"])
def credit_player():
    denied = admin_guard()
    if denied:
        return denied

    payload = request.get_json(silent=True) or {}
    player_id = payload.get("player_id")
    amount = float(payload.get("amount") or 0)
    description = (payload.get("description") or "Alimentation solde").strip()

    if not player_id or amount <= 0:
        return jsonify({"success": False, "error": "invalid_payload"}), 400

    conn = current_app.get_db_connection()
    player = conn.execute("SELECT id FROM players WHERE id = ?", (player_id,)).fetchone()
    if not player:
        conn.close()
        return jsonify({"success": False, "error": "player_not_found"}), 404

    conn.execute(
        """
        INSERT INTO transactions (player_id, amount, type, description)
        VALUES (?, ?, 'credit', ?)
        """,
        (player_id, amount, description),
    )
    conn.execute(
        """
        UPDATE wallets
        SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
        WHERE player_id = ?
        """,
        (amount, player_id),
    )
    balance = conn.execute(
        "SELECT balance FROM wallets WHERE player_id = ?", (player_id,)
    ).fetchone()["balance"]
    conn.commit()
    conn.close()

    return jsonify({"success": True, "balance": round(float(balance), 2)})


@finance_bp.route("/finance/export", methods=["GET"])
def export_finance():
    denied = admin_guard()
    if denied:
        return denied

    export_type = request.args.get("type", "transactions")

    conn = current_app.get_db_connection()
    output = io.StringIO()

    if export_type == "players":
        rows = conn.execute(
            """
            SELECT
              p.id,
              p.first_name,
              p.last_name,
              p.phone,
              COALESCE(w.balance, 0) AS balance,
              p.active
            FROM players p
            LEFT JOIN wallets w ON w.player_id = p.id
            ORDER BY p.id ASC
            """
        ).fetchall()
        writer = csv.writer(output)
        writer.writerow(["id", "first_name", "last_name", "phone", "balance", "active"])
        for row in rows:
            writer.writerow(
                [
                    row["id"],
                    row["first_name"] or "",
                    row["last_name"] or "",
                    row["phone"],
                    round(float(row["balance"] or 0), 2),
                    row["active"],
                ]
            )
        filename = f"joueurs_{datetime.now().strftime('%Y%m%d')}.csv"
    else:
        rows = conn.execute(
            """
            SELECT
              t.id,
              p.first_name,
              p.last_name,
              p.phone,
              t.amount,
              t.type,
              t.description,
              t.created_at
            FROM transactions t
            JOIN players p ON p.id = t.player_id
            ORDER BY datetime(t.created_at) DESC, t.id DESC
            """
        ).fetchall()
        writer = csv.writer(output)
        writer.writerow(
            ["id", "first_name", "last_name", "phone", "amount", "type", "description", "created_at"]
        )
        for row in rows:
            writer.writerow(
                [
                    row["id"],
                    row["first_name"] or "",
                    row["last_name"] or "",
                    row["phone"],
                    row["amount"],
                    row["type"],
                    row["description"] or "",
                    row["created_at"],
                ]
            )
        filename = f"cotisations_{datetime.now().strftime('%Y%m%d')}.csv"

    conn.close()
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@finance_bp.route("/finance/import", methods=["POST"])
def import_finance():
    denied = admin_guard()
    if denied:
        return denied

    file = request.files.get("file")
    if not file:
        return jsonify({"success": False, "error": "file_required"}), 400

    content = file.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        return jsonify({"success": False, "error": "empty_csv"}), 400

    conn = current_app.get_db_connection()
    created = 0
    credited = 0
    errors = []

    for index, row in enumerate(reader, start=2):
        try:
            phone = normalize_phone(row.get("phone") or row.get("telephone") or "")
            if not phone:
                errors.append(f"Ligne {index}: telephone manquant")
                continue

            amount = float(row.get("amount") or row.get("montant") or row.get("balance") or 0)
            description = (row.get("description") or "Import CSV").strip()

            player = conn.execute("SELECT id FROM players WHERE phone = ?", (phone,)).fetchone()

            if not player:
                cur = conn.execute(
                    """
                    INSERT INTO players (name, first_name, last_name, phone, role, active)
                    VALUES ('-', '', '', ?, 'player', 1)
                    """,
                    (phone,),
                )
                player_id = cur.lastrowid
                apply_id_label(conn, player_id)
                conn.execute(
                    "INSERT INTO wallets (player_id, balance) VALUES (?, 0)",
                    (player_id,),
                )
                created += 1
            else:
                player_id = player["id"]
                apply_id_label(conn, player_id)

            if amount > 0:
                conn.execute(
                    """
                    INSERT INTO transactions (player_id, amount, type, description)
                    VALUES (?, ?, 'credit', ?)
                    """,
                    (player_id, amount, description),
                )
                conn.execute(
                    """
                    UPDATE wallets
                    SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
                    WHERE player_id = ?
                    """,
                    (amount, player_id),
                )
                credited += 1
        except (TypeError, ValueError) as exc:
            errors.append(f"Ligne {index}: {exc}")

    conn.commit()
    conn.close()

    return jsonify(
        {
            "success": True,
            "players_created": created,
            "credits_applied": credited,
            "errors": errors[:20],
        }
    )
