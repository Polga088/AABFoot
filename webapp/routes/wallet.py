from datetime import datetime, timedelta

from flask import Blueprint, current_app, redirect, render_template, url_for

from auth_utils import login_required, logout_player, mask_phone
from auth_utils import is_session_admin
from player_utils import player_id_label, player_public_label


wallet_bp = Blueprint("wallet", __name__, url_prefix="/")


def _iso_week_bounds(now=None):
    now = now or datetime.now()
    start = now - timedelta(days=now.weekday())
    start = datetime(start.year, start.month, start.day)
    end = start + timedelta(days=7)
    return start, end


def _build_running_transactions(transactions, current_balance):
    total_delta = sum(float(tx["amount"] or 0) for tx in transactions)
    running = float(current_balance or 0) - total_delta
    enriched = []
    for tx in reversed(transactions):
        item = dict(tx)
        running += float(item["amount"] or 0)
        item["running_balance"] = round(running, 2)
        enriched.append(item)
    return list(reversed(enriched))


def _week_start(dt):
    return dt - timedelta(days=dt.weekday())


def _compute_weekly_balances(transactions, current_balance):
    now = datetime.now()
    start_of_this_week = _week_start(now).replace(hour=0, minute=0, second=0, microsecond=0)
    week_starts = [start_of_this_week - timedelta(weeks=i) for i in range(7, -1, -1)]

    tx_parsed = []
    for tx in transactions:
        created = tx["created_at"] or ""
        try:
            tx_dt = datetime.fromisoformat(created.replace("Z", ""))
        except ValueError:
            tx_dt = datetime.strptime(created.split(".")[0], "%Y-%m-%d %H:%M:%S")
        tx_parsed.append({"amount": float(tx["amount"] or 0), "created_at": tx_dt})

    week_data = []
    for ws in week_starts:
        cutoff = ws + timedelta(days=7)
        after_cutoff_sum = sum(item["amount"] for item in tx_parsed if item["created_at"] > cutoff)
        end_balance = float(current_balance or 0) - after_cutoff_sum
        week_data.append({"label": f"S{ws.isocalendar().week}", "balance": round(end_balance, 2)})

    return week_data


@wallet_bp.route("/wallet", methods=["GET"])
@login_required
def wallet_dashboard():
    from flask import session

    player_id = session["player_id"]
    conn = current_app.get_db_connection()
    player = conn.execute(
        """
        SELECT id, name, first_name, last_name, phone, display_name, created_at, active
        FROM players WHERE id = ? LIMIT 1
        """,
        (player_id,),
    ).fetchone()
    if not player or not player["active"]:
        conn.close()
        logout_player()
        return redirect(url_for("auth.login_page", info="Session expirée. Reconnecte-toi."))

    wallet = conn.execute(
        "SELECT balance, updated_at FROM wallets WHERE player_id = ? LIMIT 1",
        (player_id,),
    ).fetchone()
    balance = float(wallet["balance"] if wallet else 0)

    transactions = conn.execute(
        """
        SELECT id, amount, type, description, created_at
        FROM transactions
        WHERE player_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 50
        """,
        (player_id,),
    ).fetchall()

    recent_matches = conn.execute(
        """
        SELECT m.id, m.date, m.time, m.location, COALESCE(a.status, 'pending') AS status
        FROM matches m
        LEFT JOIN availabilities a
          ON a.match_id = m.id
         AND a.player_id = ?
        ORDER BY m.date DESC, m.time DESC
        LIMIT 10
        """,
        (player_id,),
    ).fetchall()

    attendance_yes = sum(1 for row in recent_matches if row["status"] == "yes")
    attendance_known = sum(1 for row in recent_matches if row["status"] in ("yes", "no"))
    attendance_rate = round((attendance_yes / attendance_known) * 100, 1) if attendance_known else 0

    season_start = datetime(datetime.now().year, 1, 1).strftime("%Y-%m-%d 00:00:00")
    total_credited = conn.execute(
        """
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM transactions
        WHERE player_id = ?
          AND amount > 0
          AND datetime(created_at) >= datetime(?)
        """,
        (player_id, season_start),
    ).fetchone()["total"]

    total_cotisations = conn.execute(
        """
        SELECT COALESCE(SUM(ABS(amount)), 0) AS total
        FROM transactions
        WHERE player_id = ?
          AND type = 'cotisation'
          AND datetime(created_at) >= datetime(?)
        """,
        (player_id, season_start),
    ).fetchone()["total"]

    week_start, week_end = _iso_week_bounds()
    paid_this_week = (
        conn.execute(
            """
        SELECT COUNT(*) AS count
        FROM transactions
        WHERE player_id = ?
          AND type = 'cotisation'
          AND datetime(created_at) >= datetime(?)
          AND datetime(created_at) < datetime(?)
        """,
            (player_id, week_start.strftime("%Y-%m-%d %H:%M:%S"), week_end.strftime("%Y-%m-%d %H:%M:%S")),
        ).fetchone()["count"]
        > 0
    )

    running_transactions = _build_running_transactions(transactions, balance)
    weekly_balances = _compute_weekly_balances(transactions, balance)

    conn.close()

    player_name = player_public_label(dict(player), is_session_admin())
    initials = f"#{player['id']}"[-2:] if player["id"] else "??"
    masked_phone = mask_phone(player["phone"] or "")

    return render_template(
        "wallet.html",
        active_page="wallet",
        player={
            "id": player["id"],
            "name": player_name,
            "phone": player["phone"],
            "masked_phone": masked_phone,
            "initials": initials,
            "created_at": player["created_at"],
            "active": bool(player["active"]),
        },
        balance=balance,
        paid_this_week=paid_this_week,
        transactions=[dict(row) for row in running_transactions],
        availabilities=[dict(row) for row in recent_matches],
        stats={
            "attendance_rate": attendance_rate,
            "total_credited": round(float(total_credited or 0), 2),
            "total_cotisations": round(float(total_cotisations or 0), 2),
            "matches_yes": attendance_yes,
            "matches_total": len(recent_matches),
        },
        weekly_balances=weekly_balances,
    )


@wallet_bp.route("/wallet/logout", methods=["GET"])
def wallet_logout():
    logout_player()
    return redirect(url_for("auth.login_page", info="Tu es déconnecté."))
