import re


def to_canonical_digits(raw_phone):
    digits = re.sub(r"\D", "", raw_phone or "")
    if not digits:
        return ""

    if len(digits) == 10 and digits.startswith("0"):
        digits = f"212{digits[1:]}"
    elif len(digits) == 9 and digits.startswith("6"):
        digits = f"212{digits}"

    if digits.startswith("212") and len(digits) >= 12:
        return digits[:12]

    return digits


def normalize_phone(raw_phone):
    value = (raw_phone or "").strip()
    if not value:
        return ""

    if "@" in value:
        digits = to_canonical_digits(value.split("@", 1)[0])
        return f"{digits}@c.us" if digits else value

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
