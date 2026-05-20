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
    from phone_utils import normalize_phone as canonical_normalize

    return canonical_normalize(raw_phone)
