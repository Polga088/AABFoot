import os
import re
import time
from functools import wraps

from flask import flash, redirect, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

RATE_LIMIT = {}
MAX_ATTEMPTS_PER_HOUR = 8
WINDOW_SECONDS = 3600
PIN_MIN_LEN = 4
PIN_MAX_LEN = 6


def normalize_phone_candidates(raw_phone):
    """Return a set of phone variants to match players.phone in DB."""
    from phone_utils import normalize_phone_candidates as canonical_candidates

    return canonical_candidates(raw_phone)


def mask_phone(phone):
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) <= 8:
        return phone
    return f"{digits[:3]}{digits[3:8]}***"


def validate_pin(pin):
    pin = (pin or "").strip()
    if not pin.isdigit():
        return False, "Le code doit contenir uniquement des chiffres (4 à 6)."
    if len(pin) < PIN_MIN_LEN or len(pin) > PIN_MAX_LEN:
        return False, f"Le code doit faire entre {PIN_MIN_LEN} et {PIN_MAX_LEN} chiffres."
    return True, pin


def hash_pin(pin):
    # pbkdf2:sha256 — compatible Python 3.9 / macOS (scrypt absent de hashlib)
    return generate_password_hash(pin, method="pbkdf2:sha256")


def verify_pin(pin, password_hash):
    if not password_hash:
        return False
    return check_password_hash(password_hash, pin)


def find_player_by_phone(conn, raw_phone):
    candidates = normalize_phone_candidates(raw_phone)
    if not candidates:
        return None
    placeholders = ",".join(["?"] * len(candidates))
    return conn.execute(
        f"""
        SELECT id, name, first_name, last_name, phone, role, active, password_hash
        FROM players
        WHERE phone IN ({placeholders})
        LIMIT 1
        """,
        tuple(candidates),
    ).fetchone()


def player_display_name(player_row):
    if not player_row:
        return ""
    from player_utils import player_id_label

    return player_id_label(player_row)


def is_authenticated():
    return bool(session.get("player_id") and session.get("auth"))


def is_session_admin():
    return is_authenticated() and bool(session.get("is_admin"))


def player_is_admin(player_row):
    if not player_row:
        return False
    role = str(player_row["role"] if "role" in player_row.keys() else "").lower()
    if role == "admin":
        return True
    admin_phone = os.getenv("ADMIN_PHONE", "").strip()
    if not admin_phone:
        return False
    return bool(normalize_phone_candidates(admin_phone) & normalize_phone_candidates(player_row["phone"] or ""))


def login_player(player_id, player_name, is_admin=False):
    session.clear()
    session["player_id"] = player_id
    session["player_name"] = player_name
    session["auth"] = True
    session["is_admin"] = bool(is_admin)


def logout_player():
    session.clear()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_authenticated():
            from flask import redirect, request, url_for

            nxt = request_path_safe()
            if nxt:
                return redirect(url_for("auth.login_page", next=nxt))
            return redirect(url_for("auth.login_page"))
        return view(*args, **kwargs)

    return wrapped


def admin_page_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        from flask import redirect, request, url_for

        if not is_authenticated():
            nxt = request.path
            if request.query_string:
                nxt = request.full_path
            return redirect(url_for("auth.login_page", next=nxt))
        if not is_session_admin():
            flash("Accès réservé aux administrateurs de l'équipe.", "error")
            return redirect(url_for("wallet.wallet_dashboard"))
        return view(*args, **kwargs)

    return wrapped


def request_path_safe():
    from flask import request

    path = request.full_path if request.query_string else request.path
    if path.startswith("/connexion") or path.startswith("/wallet/logout"):
        return ""
    return path


def rate_limited(ip):
    now = time.time()
    entries = [ts for ts in RATE_LIMIT.get(ip, []) if now - ts < WINDOW_SECONDS]
    RATE_LIMIT[ip] = entries
    return len(entries) >= MAX_ATTEMPTS_PER_HOUR


def record_attempt(ip):
    RATE_LIMIT.setdefault(ip, []).append(time.time())


def client_ip(request):
    return request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
