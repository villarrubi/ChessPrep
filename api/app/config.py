from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _boolean_setting(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().casefold() in {"1", "true", "yes", "on"}


def _list_setting(name: str, default: str) -> tuple[str, ...]:
    return tuple(
        item.strip()
        for item in os.getenv(name, default).split(",")
        if item.strip()
    )


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime configuration read once at the application boundary."""

    enable_api_docs: bool
    cors_origins: tuple[str, ...]
    allowed_hosts: tuple[str, ...]
    web_dir: Path
    max_request_bytes: int = 6_000_000

    @classmethod
    def from_environment(cls) -> "Settings":
        default_web_dir = Path(__file__).resolve().parents[2] / "web"
        return cls(
            enable_api_docs=_boolean_setting("CHESSPREP_ENABLE_DOCS", True),
            cors_origins=_list_setting(
                "CHESSPREP_CORS_ORIGINS",
                "http://localhost:3000,http://localhost:8000",
            ),
            allowed_hosts=_list_setting(
                "CHESSPREP_ALLOWED_HOSTS",
                "localhost,127.0.0.1,[::1],testserver",
            ),
            web_dir=Path(os.getenv("CHESSPREP_WEB_DIR", default_web_dir)),
        )
