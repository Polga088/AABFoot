"""Réglages partagés webapp + bot (SQLite)."""

import os


def ensure_app_settings_table(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    if row and row["value"] not in (None, ""):
        return row["value"]
    return default


def set_setting(conn, key, value):
    conn.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
        """,
        (key, str(value)),
    )


def get_default_cotisation(conn):
    stored = get_setting(conn, "default_cotisation")
    if stored is not None:
        try:
            amount = float(stored)
            if amount > 0:
                return amount
        except (TypeError, ValueError):
            pass
    return float(os.getenv("COTISATION_AMOUNT", "10") or 10)


def set_default_cotisation(conn, amount):
    set_setting(conn, "default_cotisation", round(float(amount), 2))
