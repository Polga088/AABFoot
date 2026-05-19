"""Affichage joueur par ID — les colonnes name/first_name/last_name restent en base pour compatibilité."""


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
