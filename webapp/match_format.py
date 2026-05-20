import re


def format_max_players(match_format):
    value = (match_format or "").strip().lower()
    match = re.match(r"^(\d+)v(\d+)$", value)
    if not match:
        return None
    return int(match.group(1)) + int(match.group(2))
