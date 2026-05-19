import os

from flask import jsonify, request


def admin_guard():
    try:
        from auth_utils import is_session_admin

        if is_session_admin():
            return None
    except ImportError:
        pass

    admin_token = os.getenv("ADMIN_TOKEN", "")
    request_token = request.headers.get("X-Admin-Token", "")
    if admin_token and request_token == admin_token:
        return None
    return jsonify({"success": False, "error": "forbidden"}), 403


def normalize_phone(raw_phone):
    value = (raw_phone or "").strip().replace(" ", "").replace("-", "")
    if value.startswith("+"):
        value = value[1:]
    value = value.replace("@c.us", "")
    digits = "".join(ch for ch in value if ch.isdigit())
    if not digits:
        return ""
    return f"{digits}@c.us"
