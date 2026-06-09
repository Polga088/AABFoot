import re


def is_valid_player_phone_digits(digits):
    if not digits:
        return False
    return bool(re.fullmatch(r"212[67]\d{8}", digits))


def to_canonical_digits(raw_phone):
    digits = re.sub(r"\D", "", raw_phone or "")
    if not digits:
        return ""

    if len(digits) == 10 and digits.startswith("0"):
        digits = f"212{digits[1:]}"
    elif len(digits) == 9 and digits[0] in "67":
        digits = f"212{digits}"

    if digits.startswith("212") and len(digits) > 12:
        digits = digits[:12]

    return digits if is_valid_player_phone_digits(digits) else ""


def normalize_phone(raw_phone):
    value = (raw_phone or "").strip()
    if not value:
        return ""

    if "@" in value:
        digits = to_canonical_digits(value.split("@", 1)[0])
        return f"{digits}@c.us" if digits else ""

    digits = to_canonical_digits(value)
    if not digits:
        return ""
    return f"{digits}@c.us"


def normalize_phone_candidates(raw_phone):
    canonical = normalize_phone(raw_phone)
    if not canonical:
        return set()

    digits = canonical.replace("@c.us", "")
    candidates = {canonical, digits, f"{digits}@c.us", f"+{digits}", f"+{digits}@c.us"}

    if digits.startswith("212") and len(digits) >= 12:
        local = f"0{digits[3:]}"
        candidates.add(local)
        candidates.add(f"{local}@c.us")

    return {c for c in candidates if c}


def format_local_phone(raw_phone):
    canonical = normalize_phone(raw_phone)
    if not canonical:
        return ""
    digits = canonical.replace("@c.us", "")
    if digits.startswith("212") and len(digits) >= 12:
        return f"0{digits[3:]}"
    return digits


def find_player_row_by_phone(conn, raw_phone):
    """Match joueur par 06… ou 212… (toutes variantes)."""
    candidates = normalize_phone_candidates(raw_phone)
    if not candidates:
        return None
    placeholders = ",".join(["?"] * len(candidates))
    return conn.execute(
        f"SELECT * FROM players WHERE phone IN ({placeholders}) LIMIT 1",
        tuple(candidates),
    ).fetchone()


def normalize_players_in_db(conn):
    """Stocke tous les téléphones au format canonique 212…@c.us quand possible."""
    rows = conn.execute("SELECT id, phone FROM players ORDER BY id ASC").fetchall()
    updated = 0
    for row in rows:
        canonical = normalize_phone(row["phone"])
        if not canonical or row["phone"] == canonical:
            continue
        conflict = conn.execute(
            "SELECT id FROM players WHERE phone = ? AND id != ?",
            (canonical, row["id"]),
        ).fetchone()
        if conflict:
            continue
        conn.execute("UPDATE players SET phone = ? WHERE id = ?", (canonical, row["id"]))
        updated += 1
    return updated
