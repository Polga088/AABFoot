from flask import Blueprint, current_app, redirect, render_template, request, session, url_for

from auth_utils import (
    client_ip,
    find_player_by_phone,
    hash_pin,
    is_authenticated,
    login_player,
    logout_player,
    player_display_name,
    player_is_admin,
    rate_limited,
    record_attempt,
    validate_pin,
    verify_pin,
)


auth_bp = Blueprint("auth", __name__)


def _safe_next_url():
    nxt = (request.args.get("next") or request.form.get("next") or "").strip()
    if nxt.startswith("/") and not nxt.startswith("//"):
        return nxt
    return url_for("wallet.wallet_dashboard")


@auth_bp.route("/connexion", methods=["GET"])
def login_page():
    if is_authenticated():
        return redirect(_safe_next_url() if request.args.get("next") else url_for("wallet.wallet_dashboard"))
    return render_template(
        "auth/login.html",
        active_page="auth",
        error=None,
        info=request.args.get("info"),
        next_url=request.args.get("next") or "",
    )


@auth_bp.route("/connexion", methods=["POST"])
def login_submit():
    ip = client_ip(request)
    next_url = _safe_next_url()

    if rate_limited(ip):
        return (
            render_template(
                "auth/login.html",
                active_page="auth",
                error="Trop de tentatives. Réessaie dans environ 1 heure.",
                info=None,
                next_url=request.form.get("next") or "",
            ),
            429,
        )

    raw_phone = request.form.get("phone", "")
    pin = request.form.get("pin", "")

    conn = current_app.get_db_connection()
    player = find_player_by_phone(conn, raw_phone)
    conn.close()

    if not player:
        record_attempt(ip)
        return (
            render_template(
                "auth/login.html",
                active_page="auth",
                error="Numéro non reconnu. Essaie 0663104773 ou 212663104773 (même format).",
                info=None,
                next_url=request.form.get("next") or "",
            ),
            404,
        )

    if not player["active"]:
        record_attempt(ip)
        return (
            render_template(
                "auth/login.html",
                active_page="auth",
                error="Compte désactivé. Contacte un admin de l'équipe.",
                info=None,
                next_url=request.form.get("next") or "",
            ),
            403,
        )

    if not player["password_hash"]:
        session["pending_player_id"] = player["id"]
        session["pending_player_name"] = player_display_name(player)
        next_param = request.form.get("next") or ""
        return redirect(url_for("auth.setup_pin_page", next=next_param))

    if not (pin or "").strip():
        return (
            render_template(
                "auth/login.html",
                active_page="auth",
                error="Entre ton code PIN pour te connecter.",
                info=None,
                next_url=request.form.get("next") or "",
            ),
            400,
        )

    ok, pin_or_msg = validate_pin(pin)
    if not ok:
        record_attempt(ip)
        return (
            render_template(
                "auth/login.html",
                active_page="auth",
                error=pin_or_msg,
                info=None,
                next_url=request.form.get("next") or "",
            ),
            400,
        )

    if not verify_pin(pin_or_msg, player["password_hash"]):
        record_attempt(ip)
        return (
            render_template(
                "auth/login.html",
                active_page="auth",
                error="Code PIN incorrect.",
                info=None,
                next_url=request.form.get("next") or "",
            ),
            401,
        )

    login_player(player["id"], player_display_name(player), is_admin=player_is_admin(player))
    return redirect(next_url)


@auth_bp.route("/connexion/initialiser", methods=["GET"])
def setup_pin_page():
    player_id = session.get("pending_player_id")
    if not player_id and is_authenticated():
        return redirect(url_for("wallet.wallet_dashboard"))

    if not player_id:
        return redirect(url_for("auth.login_page", info="Entre d'abord ton numéro de téléphone."))

    return render_template(
        "auth/setup_pin.html",
        active_page="auth",
        player_name=session.get("pending_player_name") or "Joueur",
        error=None,
        next_url=request.args.get("next") or "",
    )


@auth_bp.route("/connexion/initialiser", methods=["POST"])
def setup_pin_submit():
    ip = client_ip(request)
    player_id = session.get("pending_player_id")
    next_url = _safe_next_url()

    if not player_id:
        return redirect(url_for("auth.login_page"))

    if rate_limited(ip):
        return (
            render_template(
                "auth/setup_pin.html",
                active_page="auth",
                player_name=session.get("pending_player_name") or "Joueur",
                error="Trop de tentatives. Réessaie plus tard.",
                next_url=request.form.get("next") or "",
            ),
            429,
        )

    pin = request.form.get("pin", "")
    pin_confirm = request.form.get("pin_confirm", "")

    ok, pin_or_msg = validate_pin(pin)
    if not ok:
        return (
            render_template(
                "auth/setup_pin.html",
                active_page="auth",
                player_name=session.get("pending_player_name") or "Joueur",
                error=pin_or_msg,
                next_url=request.form.get("next") or "",
            ),
            400,
        )

    ok2, confirm_or_msg = validate_pin(pin_confirm)
    if not ok2:
        return (
            render_template(
                "auth/setup_pin.html",
                active_page="auth",
                player_name=session.get("pending_player_name") or "Joueur",
                error=confirm_or_msg,
                next_url=request.form.get("next") or "",
            ),
            400,
        )

    if pin_or_msg != confirm_or_msg:
        return (
            render_template(
                "auth/setup_pin.html",
                active_page="auth",
                player_name=session.get("pending_player_name") or "Joueur",
                error="Les deux codes ne correspondent pas.",
                next_url=request.form.get("next") or "",
            ),
            400,
        )

    conn = current_app.get_db_connection()
    player = conn.execute(
        "SELECT id, name, first_name, last_name, phone, role, active, password_hash FROM players WHERE id = ? LIMIT 1",
        (player_id,),
    ).fetchone()

    if not player or not player["active"]:
        conn.close()
        session.pop("pending_player_id", None)
        return redirect(url_for("auth.login_page"))

    if player["password_hash"]:
        conn.close()
        session.pop("pending_player_id", None)
        return redirect(url_for("auth.login_page", info="Ton code est déjà configuré. Connecte-toi."))

    conn.execute(
        "UPDATE players SET password_hash = ? WHERE id = ?",
        (hash_pin(pin_or_msg), player_id),
    )
    conn.commit()
    conn.close()

    session.pop("pending_player_id", None)
    session.pop("pending_player_name", None)
    login_player(player_id, player_display_name(player), is_admin=player_is_admin(player))
    return redirect(next_url)


@auth_bp.route("/connexion/deconnexion", methods=["GET"])
def logout():
    logout_player()
    return redirect(url_for("auth.login_page", info="Tu es déconnecté."))
