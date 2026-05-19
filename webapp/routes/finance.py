import csv
import io
import os
from datetime import datetime

from flask import Blueprint, Response, current_app, jsonify, render_template, request

from auth_utils import admin_page_required
from player_utils import apply_id_label
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
          p.phone,
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
    conn.close()

    return render_template(
        "finance.html",
        active_page="finance",
        players=[dict(row) for row in players],
        transactions=[dict(row) for row in transactions],
        cotisation_amount=os.getenv("COTISATION_AMOUNT", "10"),
        admin_token_configured=bool(os.getenv("ADMIN_TOKEN", "").strip()),
    )


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
