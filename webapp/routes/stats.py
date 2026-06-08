from flask import Blueprint, abort, current_app, render_template

from auth_utils import is_session_admin, login_required
from match_stats_db import compute_player_stats, ensure_match_stats_tables
from player_utils import apply_labels_to_goals, load_player_labels, player_public_label


stats_bp = Blueprint("stats", __name__, url_prefix="/")


@stats_bp.route("/statistiques", methods=["GET"])
@login_required
def stats_leaderboard():
    conn = current_app.get_db_connection()
    ensure_match_stats_tables(conn)
    all_stats = compute_player_stats(conn)
    is_admin = is_session_admin()
    if all_stats:
        labels = load_player_labels(conn, [s["id"] for s in all_stats], is_admin)
        for item in all_stats:
            item["name"] = labels.get(item["id"], f"#{item['id']}")
    conn.close()

    top_scorers = sorted(all_stats, key=lambda x: (-x["goals"], -x["assists"]))[:5]
    top_assists = sorted(all_stats, key=lambda x: (-x["assists"], -x["goals"]))[:5]

    return render_template(
        "stats.html",
        active_page="stats",
        players_stats=all_stats,
        top_scorers=top_scorers,
        top_assists=top_assists,
    )


@stats_bp.route("/statistiques/joueur/<int:player_id>", methods=["GET"])
@login_required
def player_profile(player_id):
    conn = current_app.get_db_connection()
    ensure_match_stats_tables(conn)
    row = conn.execute(
        "SELECT id, name, phone, display_name, active, role FROM players WHERE id = ?",
        (player_id,),
    ).fetchone()
    if not row:
        conn.close()
        abort(404)

    stats_list = compute_player_stats(conn, player_id=player_id)
    player_stats = stats_list[0] if stats_list else {
        "id": player_id,
        "name": row["name"],
        "matches_played": 0,
        "goals": 0,
        "assists": 0,
        "motm_votes": 0,
        "motm_wins": 0,
        "points": 0,
    }

    goals_detail = conn.execute(
        """
        SELECT g.id, g.player_id, g.assist_player_id, m.id AS match_id, m.date,
               m.opponent, m.event_kind, g.team
        FROM match_goals g
        JOIN matches m ON m.id = g.match_id
        WHERE g.player_id = ?
        ORDER BY m.date DESC, g.id DESC
        LIMIT 30
        """,
        (player_id,),
    ).fetchall()

    assist_rows = conn.execute(
        """
        SELECT g.id, m.id AS match_id, m.date, g.player_id AS scorer_id
        FROM match_goals g
        JOIN matches m ON m.id = g.match_id
        WHERE g.assist_player_id = ?
        ORDER BY m.date DESC, g.id DESC
        LIMIT 30
        """,
        (player_id,),
    ).fetchall()

    is_admin = is_session_admin()
    goals_detail = apply_labels_to_goals([dict(g) for g in goals_detail], conn, is_admin)
    scorer_labels = load_player_labels(
        conn,
        [r["scorer_id"] for r in assist_rows if r["scorer_id"]],
        is_admin,
    )
    assists_detail = [
        {
            "id": r["id"],
            "match_id": r["match_id"],
            "date": r["date"],
            "scorer_name": scorer_labels.get(r["scorer_id"], f"#{r['scorer_id']}"),
        }
        for r in assist_rows
    ]

    player_label = player_public_label(dict(row), is_admin)
    if player_stats:
        player_stats["name"] = player_label

    conn.close()

    return render_template(
        "player_profile.html",
        active_page="stats",
        player=dict(row),
        player_label=player_label,
        stats=player_stats,
        goals_detail=goals_detail,
        assists_detail=assists_detail,
    )

