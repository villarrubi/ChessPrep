from __future__ import annotations

import re


_CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_untrusted_text(value: object, *, max_length: int = 240) -> str:
    """Normalise provider/PGN text while keeping it as plain, non-HTML data."""

    text = _CONTROL_CHARACTERS.sub(" ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_length]


def clean_identifier(value: object, *, max_length: int = 120) -> str | None:
    """Return a short route-safe identifier without carrying PGN markup."""

    text = clean_untrusted_text(value, max_length=max_length)
    text = re.sub(r"[^A-Za-z0-9._:-]+", "-", text).strip("-.")
    return text[:max_length] or None
