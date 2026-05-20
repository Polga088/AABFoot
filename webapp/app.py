import os
import sqlite3

from flask import Flask, jsonify

from routes.auth import auth_bp
from routes.calendar import calendar_bp
from routes.finance import finance_bp
from routes.history import history_bp
from routes.players import players_bp
from routes.wallet import wallet_bp


def ensure_match_columns(db_path):
    conn = sqlite3.connect(db_path)
    try:
        cols = {row[0] for row in conn.execute("SELECT name FROM pragma_table_info('matches')").fetchall()}
        migrations = [
            ("score_a", "ALTER TABLE matches ADD COLUMN score_a INTEGER DEFAULT NULL"),
            ("score_b", "ALTER TABLE matches ADD COLUMN score_b INTEGER DEFAULT NULL"),
            ("notes", "ALTER TABLE matches ADD COLUMN notes TEXT"),
            ("homme_du_match", "ALTER TABLE matches ADD COLUMN homme_du_match TEXT"),
            ("event_kind", "ALTER TABLE matches ADD COLUMN event_kind TEXT DEFAULT 'training'"),
            ("opponent", "ALTER TABLE matches ADD COLUMN opponent TEXT"),
            ("format", "ALTER TABLE matches ADD COLUMN format TEXT DEFAULT '5v5'"),
            ("maps_url", "ALTER TABLE matches ADD COLUMN maps_url TEXT"),
            ("poll_message_id", "ALTER TABLE matches ADD COLUMN poll_message_id TEXT"),
            ("poll_requested_at", "ALTER TABLE matches ADD COLUMN poll_requested_at DATETIME"),
            ("poll_sent_at", "ALTER TABLE matches ADD COLUMN poll_sent_at DATETIME"),
            (
                "lineup_notify_requested_at",
                "ALTER TABLE matches ADD COLUMN lineup_notify_requested_at DATETIME",
            ),
            ("lineup_notified_at", "ALTER TABLE matches ADD COLUMN lineup_notified_at DATETIME"),
            ("poll_delete_requested_at", "ALTER TABLE matches ADD COLUMN poll_delete_requested_at DATETIME"),
            ("poll_republish_requested_at", "ALTER TABLE matches ADD COLUMN poll_republish_requested_at DATETIME"),
            ("poll_send_stopped", "ALTER TABLE matches ADD COLUMN poll_send_stopped INTEGER DEFAULT 0"),
            ("lineup_notify_force", "ALTER TABLE matches ADD COLUMN lineup_notify_force INTEGER DEFAULT 0"),
        ]
        for col_name, sql in migrations:
            if col_name not in cols:
                conn.execute(sql)
        conn.commit()
    finally:
        conn.close()


def ensure_player_auth_columns(db_path):
    conn = sqlite3.connect(db_path)
    try:
        cols = {row[0] for row in conn.execute("SELECT name FROM pragma_table_info('players')").fetchall()}
        if "password_hash" not in cols:
            conn.execute("ALTER TABLE players ADD COLUMN password_hash TEXT")
        conn.commit()
    finally:
        conn.close()


def ensure_player_columns(db_path):
    conn = sqlite3.connect(db_path)
    try:
        cols = {row[0] for row in conn.execute("SELECT name FROM pragma_table_info('players')").fetchall()}
        for col_name, sql in [
            ("first_name", "ALTER TABLE players ADD COLUMN first_name TEXT"),
            ("last_name", "ALTER TABLE players ADD COLUMN last_name TEXT"),
        ]:
            if col_name not in cols:
                conn.execute(sql)
        conn.execute(
            """
            UPDATE players
            SET first_name = COALESCE(NULLIF(first_name, ''), name),
                last_name = COALESCE(last_name, '')
            """
        )
        conn.commit()
    finally:
        conn.close()


def ensure_availability_columns(db_path):
    conn = sqlite3.connect(db_path)
    try:
        cols = {row[0] for row in conn.execute("SELECT name FROM pragma_table_info('availabilities')").fetchall()}
        if "cotisation_charged" not in cols:
            conn.execute(
                "ALTER TABLE availabilities ADD COLUMN cotisation_charged INTEGER DEFAULT 0"
            )
        conn.commit()
    finally:
        conn.close()


def ensure_db_indexes(db_path):
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_availabilities_match ON availabilities(match_id);
            CREATE INDEX IF NOT EXISTS idx_availabilities_player ON availabilities(player_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_player ON transactions(player_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
            CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date, time);
            CREATE INDEX IF NOT EXISTS idx_players_phone ON players(phone);
            """
        )
        conn.commit()
    finally:
        conn.close()


def ensure_match_media_table(db_path):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS match_media (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              match_id INTEGER NOT NULL,
              type TEXT NOT NULL,
              filename TEXT NOT NULL,
              caption TEXT,
              uploaded_by TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (match_id) REFERENCES matches(id)
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def load_env_file(project_root):
    env_path = os.path.join(project_root, ".env")
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as handle:
        for line in handle:
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, value = raw.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def create_app():
    app = Flask(__name__)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(base_dir, ".."))
    load_env_file(project_root)

    db_path = os.path.abspath(os.path.join(project_root, "football.db"))
    upload_dir = os.path.join(base_dir, "static", "uploads", "matches")
    app.secret_key = os.getenv("SECRET_KEY", "footbot-dev-secret-key")

    os.makedirs(upload_dir, exist_ok=True)

    app.config["DATABASE"] = db_path
    app.config["UPLOAD_FOLDER"] = upload_dir
    app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

    ensure_match_columns(db_path)
    ensure_player_columns(db_path)
    ensure_player_auth_columns(db_path)
    ensure_availability_columns(db_path)
    ensure_match_media_table(db_path)
    ensure_db_indexes(db_path)

    def get_db_connection():
        conn = sqlite3.connect(app.config["DATABASE"], timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-64000")
        conn.execute("PRAGMA temp_store=MEMORY")
        return conn

    app.get_db_connection = get_db_connection

    app.register_blueprint(auth_bp)
    app.register_blueprint(calendar_bp)
    app.register_blueprint(history_bp)
    app.register_blueprint(wallet_bp)
    app.register_blueprint(players_bp)
    app.register_blueprint(finance_bp)

    @app.context_processor
    def inject_auth_context():
        from flask import session

        from auth_utils import is_authenticated, is_session_admin

        return {
            "user_logged_in": is_authenticated(),
            "current_player_name": session.get("player_name") if is_authenticated() else None,
            "user_is_admin": is_session_admin(),
        }

    @app.route("/")
    def index():
        from flask import redirect, url_for

        from auth_utils import is_authenticated

        if is_authenticated():
            return redirect(url_for("wallet.wallet_dashboard"))
        return redirect(url_for("auth.login_page"))

    @app.route("/api/stats")
    def api_stats():
        conn = app.get_db_connection()
        total_players = conn.execute("SELECT COUNT(*) AS count FROM players WHERE active = 1").fetchone()["count"]
        matches_played = conn.execute(
            "SELECT COUNT(*) AS count FROM matches WHERE status = 'done'"
        ).fetchone()["count"]

        last_match = conn.execute(
            """
            SELECT score_a, score_b
            FROM matches
            WHERE status = 'done'
            ORDER BY date DESC, time DESC, id DESC
            LIMIT 1
            """
        ).fetchone()

        if not last_match or last_match["score_a"] is None or last_match["score_b"] is None:
            last_result = "unknown"
        elif last_match["score_a"] > last_match["score_b"]:
            last_result = "win"
        elif last_match["score_a"] < last_match["score_b"]:
            last_result = "loss"
        else:
            last_result = "draw"

        top_wallet_balance = conn.execute(
            "SELECT COALESCE(MAX(balance), 0) AS top FROM wallets"
        ).fetchone()["top"]
        conn.close()

        return jsonify(
            {
                "total_players": int(total_players or 0),
                "matches_played": int(matches_played or 0),
                "last_result": last_result,
                "top_wallet_balance": float(top_wallet_balance or 0),
            }
        )

    @app.route("/health")
    def health():
        return jsonify({"status": "ok"})

    return app


app = create_app()


if __name__ == "__main__":
    app.run(port=5000, debug=True)
