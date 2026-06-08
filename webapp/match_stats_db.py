import json
import sqlite3


def ensure_match_stats_tables(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS match_goals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          match_id INTEGER NOT NULL,
          player_id INTEGER NOT NULL,
          assist_player_id INTEGER,
          team TEXT DEFAULT 'a',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
          FOREIGN KEY (player_id) REFERENCES players(id),
          FOREIGN KEY (assist_player_id) REFERENCES players(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS match_motm_votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          match_id INTEGER NOT NULL,
          voter_player_id INTEGER NOT NULL,
          voted_player_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(match_id, voter_player_id),
          FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
          FOREIGN KEY (voter_player_id) REFERENCES players(id),
          FOREIGN KEY (voted_player_id) REFERENCES players(id)
        )
        """
    )
    cols = {row[1] for row in conn.execute("PRAGMA table_info(matches)").fetchall()}
    if "motm_player_id" not in cols:
        conn.execute("ALTER TABLE matches ADD COLUMN motm_player_id INTEGER")


def parse_lineup_ids(lineup_row):
    if not lineup_row:
        return [], []
    try:
        team_a = json.loads(lineup_row["team_a"] or "[]")
    except (TypeError, json.JSONDecodeError):
        team_a = []
    try:
        team_b = json.loads(lineup_row["team_b"] or "[]")
    except (TypeError, json.JSONDecodeError):
        team_b = []
    return team_a, team_b


def lineup_player_ids(conn, match_id):
    row = conn.execute(
        """
        SELECT team_a, team_b FROM lineups
        WHERE match_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
        """,
        (match_id,),
    ).fetchone()
    team_a, team_b = parse_lineup_ids(row)
    return list(dict.fromkeys(team_a + team_b))


def load_players_map(conn, player_ids, is_admin=False):
    from player_utils import load_player_labels

    return load_player_labels(conn, player_ids, is_admin)


def fetch_match_goals(conn, match_id):
    rows = conn.execute(
        """
        SELECT g.id, g.player_id, g.assist_player_id, g.team,
               p.name AS scorer_name,
               a.name AS assist_name
        FROM match_goals g
        JOIN players p ON p.id = g.player_id
        LEFT JOIN players a ON a.id = g.assist_player_id
        WHERE g.match_id = ?
        ORDER BY g.id ASC
        """,
        (match_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def replace_match_goals(conn, match_id, goals):
    conn.execute("DELETE FROM match_goals WHERE match_id = ?", (match_id,))
    for goal in goals:
        player_id = goal.get("player_id")
        if not player_id:
            continue
        conn.execute(
            """
            INSERT INTO match_goals (match_id, player_id, assist_player_id, team)
            VALUES (?, ?, ?, ?)
            """,
            (
                match_id,
                int(player_id),
                int(goal["assist_player_id"]) if goal.get("assist_player_id") else None,
                (goal.get("team") or "a").lower()[:1],
            ),
        )


def fetch_motm_tally(conn, match_id):
    rows = conn.execute(
        """
        SELECT v.voted_player_id AS player_id, p.name, COUNT(*) AS votes
        FROM match_motm_votes v
        JOIN players p ON p.id = v.voted_player_id
        WHERE v.match_id = ?
        GROUP BY v.voted_player_id
        ORDER BY votes DESC, p.name ASC
        """,
        (match_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def sync_motm_winner(conn, match_id):
    tally = fetch_motm_tally(conn, match_id)
    if not tally:
        return None
    winner = tally[0]
    conn.execute(
        """
        UPDATE matches
        SET motm_player_id = ?, homme_du_match = ?
        WHERE id = ?
        """,
        (winner["player_id"], winner["name"], match_id),
    )
    return winner


def _count_matches_played(conn):
    counts = {}
    rows = conn.execute(
        """
        SELECT l.match_id, l.team_a, l.team_b
        FROM lineups l
        JOIN matches m ON m.id = l.match_id
        WHERE m.status = 'done'
        """
    ).fetchall()
    seen = set()
    for row in rows:
        key = row["match_id"]
        if key in seen:
            continue
        seen.add(key)
        for pid in parse_lineup_ids(row)[0] + parse_lineup_ids(row)[1]:
            counts[pid] = counts.get(pid, 0) + 1
    return counts


def compute_player_stats(conn, player_id=None):
    played_map = _count_matches_played(conn)
    query = "SELECT id, name, active FROM players WHERE active = 1"
    params = []
    if player_id is not None:
        query += " AND id = ?"
        params.append(player_id)

    players = conn.execute(query, tuple(params)).fetchall()
    goals_map = {
        row["player_id"]: row["goals"]
        for row in conn.execute(
            "SELECT player_id, COUNT(*) AS goals FROM match_goals GROUP BY player_id"
        ).fetchall()
    }
    assists_map = {
        row["player_id"]: row["assists"]
        for row in conn.execute(
            """
            SELECT assist_player_id AS player_id, COUNT(*) AS assists
            FROM match_goals
            WHERE assist_player_id IS NOT NULL
            GROUP BY assist_player_id
            """
        ).fetchall()
    }
    motm_votes_map = {
        row["player_id"]: row["motm_votes"]
        for row in conn.execute(
            """
            SELECT voted_player_id AS player_id, COUNT(*) AS motm_votes
            FROM match_motm_votes
            GROUP BY voted_player_id
            """
        ).fetchall()
    }
    motm_wins_map = {
        row["player_id"]: row["motm_wins"]
        for row in conn.execute(
            """
            SELECT motm_player_id AS player_id, COUNT(*) AS motm_wins
            FROM matches
            WHERE motm_player_id IS NOT NULL AND status = 'done'
            GROUP BY motm_player_id
            """
        ).fetchall()
    }

    stats = []
    for player in players:
        pid = player["id"]
        item = {
            "id": pid,
            "name": player["name"],
            "active": bool(player["active"]),
            "matches_played": played_map.get(pid, 0),
            "goals": int(goals_map.get(pid, 0)),
            "assists": int(assists_map.get(pid, 0)),
            "motm_votes": int(motm_votes_map.get(pid, 0)),
            "motm_wins": int(motm_wins_map.get(pid, 0)),
        }
        item["points"] = item["goals"] * 3 + item["assists"] * 2 + item["motm_wins"] * 5
        stats.append(item)

    stats.sort(
        key=lambda x: (-x["points"], -x["goals"], -x["assists"], -x["matches_played"], x["id"])
    )
    return stats
