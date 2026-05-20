from flask import Blueprint, abort, current_app, render_template

from auth_utils import login_required
from match_stats_db import compute_player_stats, ensure_match_stats_tables
from player_utils import player_id_label


stats_bp = Blueprint("stats", __name__, url_prefix="/")


@stats_bp.route("/statistiques", methods=["GET"])
@login_required
def stats_leaderboard():
    conn = current_app.get_db_connection()
    ensure_match_stats_tables(conn)
    all_stats = compute_player_stats(conn)
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
        "SELECT id, name, active, role FROM players WHERE id = ?",
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
        SELECT g.id, m.id AS match_id, m.date, m.opponent, m.event_kind, g.team,
               a.name AS assist_name
        FROM match_goals g
        JOIN matches m ON m.id = g.match_id
        LEFT JOIN players a ON a.id = g.assist_player_id
        WHERE g.player_id = ?
        ORDER BY m.date DESC, g.id DESC
        LIMIT 30
        """,
        (player_id,),
    ).fetchall()

    assists_detail = conn.execute(
        """
        SELECT g.id, m.id AS match_id, m.date, p.name AS scorer_name
        FROM match_goals g
        JOIN matches m ON m.id = g.match_id
        JOIN players p ON p.id = g.player_id
        WHERE g.assist_player_id = ?
        ORDER BY m.date DESC, g.id DESC
        LIMIT 30
        """,
        (player_id,),
    ).fetchall()

    conn.close()

    return render_template(
        "player_profile.html",
        active_page="stats",
        player=dict(row),
        player_label=player_id_label(row),
        stats=player_stats,
        goals_detail=[dict(g) for g in goals_detail],
        assists_detail=[dict(a) for a in assists_detail],
    )

