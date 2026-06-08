"""Affichage joueur — ID, nom admin, téléphone masqué pour les autres."""

import os


def player_id_label(player_or_id):
    if player_or_id is None:
        return "—"
    if isinstance(player_or_id, int):
        return f"#{player_or_id}"
    try:
        pid = player_or_id["id"]
    except (TypeError, KeyError):
        return "—"
    return f"#{pid}"


def player_public_label(player, is_admin=False):
    """Admin : nom personnalisé ou #id. Autres : numéro masqué."""
    if not player:
        return "—"
    if is_admin:
        display_name = (player.get("display_name") or "").strip()
        if display_name:
            return display_name
        return player_id_label(player)
    from auth_utils import mask_phone

    phone = player.get("phone") or ""
    if phone:
        return mask_phone(phone)
    return player_id_label(player)


def get_default_cotisation():
    return float(os.getenv("COTISATION_AMOUNT", "10") or 10)


def player_cotisation_amount(player, default=None):
    if default is None:
        default = get_default_cotisation()
    if not player:
        return default
    raw = player.get("cotisation_amount")
    if raw is None:
        return default
    try:
        val = float(raw)
        return val if val > 0 else default
    except (TypeError, ValueError):
        return default


def load_player_labels(conn, player_ids, is_admin=False):
    if not player_ids:
        return {}
    placeholders = ",".join(["?"] * len(player_ids))
    rows = conn.execute(
        f"SELECT id, phone, display_name FROM players WHERE id IN ({placeholders})",
        tuple(player_ids),
    ).fetchall()
    return {row["id"]: player_public_label(dict(row), is_admin) for row in rows}


def apply_labels_to_goals(goals, conn, is_admin):
    if not goals:
        return goals
    ids = set()
    for goal in goals:
        if goal.get("player_id"):
            ids.add(goal["player_id"])
        if goal.get("assist_player_id"):
            ids.add(goal["assist_player_id"])
    labels = load_player_labels(conn, list(ids), is_admin)
    enriched = []
    for goal in goals:
        item = dict(goal)
        pid = item.get("player_id")
        aid = item.get("assist_player_id")
        if pid:
            item["scorer_name"] = labels.get(pid, player_id_label(pid))
        if aid:
            item["assist_name"] = labels.get(aid, player_id_label(aid))
        enriched.append(item)
    return enriched


def apply_id_label(conn, player_id):
    label = f"#{player_id}"
    conn.execute(
        """
        UPDATE players
        SET name = ?, first_name = ?, last_name = ''
        WHERE id = ?
        """,
        (label, str(player_id), player_id),
    )
