from __future__ import annotations

import html
import io
import json
import re
import threading
import time
import unicodedata
import zipfile
from calendar import month_abbr
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from api.app.models import EloDiscipline, FidePlayer, FideRatingPoint, NormalizedGame
from api.app.services.text import clean_untrusted_text


BASE_URL = "https://ratings.fide.com"
USER_AGENT = "ChessPrep/1.0 (FIDE identity verification; github.com/villarrubi/ChessPrep)"
MAX_RESPONSE_BYTES = 2_000_000
MAX_HISTORY_RESPONSE_BYTES = 500_000
MAX_RATING_LIST_BYTES = 25_000_000
MAX_RATING_LIST_UNCOMPRESSED_BYTES = 130_000_000
RATING_LIST_CACHE_SECONDS = 6 * 60 * 60
RATING_LIST_URLS = {
    EloDiscipline.STANDARD: f"{BASE_URL}/download/standard_rating_list.zip",
    EloDiscipline.RAPID: f"{BASE_URL}/download/rapid_rating_list.zip",
    EloDiscipline.BLITZ: f"{BASE_URL}/download/blitz_rating_list.zip",
}
_rating_list_cache: dict[EloDiscipline, tuple[float, bytes]] = {}
_rating_list_lock = threading.Lock()
TITLE_CODES = {
    "grandmaster": "GM",
    "international master": "IM",
    "fide master": "FM",
    "candidate master": "CM",
    "woman grandmaster": "WGM",
    "woman international master": "WIM",
    "woman fide master": "WFM",
    "woman candidate master": "WCM",
}


class ProviderUnavailable(RuntimeError):
    pass


def _get_html(fide_id: str, timeout: int = 15) -> str:
    request = Request(
        f"{BASE_URL}/profile/{fide_id}",
        headers={"Accept": "text/html", "User-Agent": USER_AGENT},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ProviderUnavailable("La respuesta de FIDE supera el límite permitido.")
            return body.decode("utf-8", errors="replace")
    except HTTPError as exc:
        if exc.code == 404:
            raise LookupError("No existe una ficha pública con ese ID FIDE.") from exc
        raise ProviderUnavailable(f"FIDE respondió con el estado {exc.code}.") from exc
    except (URLError, TimeoutError) as exc:
        raise ProviderUnavailable("No se pudo conectar con la base oficial de FIDE.") from exc


def _clean_fragment(fragment: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", fragment)
    return clean_untrusted_text(html.unescape(without_tags), max_length=240)


def _match(html_text: str, pattern: str) -> str | None:
    found = re.search(pattern, html_text, flags=re.IGNORECASE | re.DOTALL)
    return _clean_fragment(found.group(1)) if found else None


def _rating(html_text: str, css_class: str) -> int | None:
    value = _match(html_text, rf'class="{css_class}[^\"]*"[^>]*>.*?<p>(.*?)</p>')
    return int(value) if value and value.isdigit() else None


def _parse_rating_history(
    payload: object, *, max_points: int | None = 60
) -> list[FideRatingPoint]:
    if not isinstance(payload, list):
        return []
    history: list[FideRatingPoint] = []
    seen_dates: set[str] = set()
    items = payload[-max_points:] if max_points else payload
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_date = str(item.get("date_2") or "").strip()
        if not re.fullmatch(r"\d{4}-[A-Z][a-z]{2}", raw_date):
            continue
        ratings: dict[str, int | None] = {}
        for output_key, source_key in (
            ("rating", "rating"),
            ("rapid_rating", "rapid_rtng"),
            ("blitz_rating", "blitz_rtng"),
        ):
            raw_rating = str(item.get(source_key) or "").strip()
            value = int(raw_rating) if raw_rating.isdigit() else 0
            ratings[output_key] = value if 100 <= value <= 4000 else None
        if not any(ratings.values()) or raw_date in seen_dates:
            continue
        seen_dates.add(raw_date)
        history.append(FideRatingPoint(date=raw_date, **ratings))
    return history


def _get_rating_history(
    fide_id: str,
    timeout: int = 8,
    *,
    period: int = 3,
    max_points: int | None = 60,
    strict: bool = False,
) -> list[FideRatingPoint]:
    request = Request(
        f"{BASE_URL}/a_chart_data.phtml?event={fide_id}&period={period}",
        data=b"",
        method="POST",
        headers={
            "Accept": "application/json",
            "Referer": f"{BASE_URL}/profile/{fide_id}",
            "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_HISTORY_RESPONSE_BYTES + 1)
            if len(body) > MAX_HISTORY_RESPONSE_BYTES:
                return []
        return _parse_rating_history(
            json.loads(body.decode("utf-8-sig", errors="strict")),
            max_points=max_points,
        )
    except (HTTPError, URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        if strict:
            raise ProviderUnavailable("No se pudo consultar el historial de FIDE.") from exc
        return []


def get_player(fide_id: str, *, include_history: bool = True) -> FidePlayer:
    clean_id = fide_id.strip()
    if not re.fullmatch(r"\d{5,10}", clean_id):
        raise LookupError("El ID FIDE debe contener entre 5 y 10 cifras.")
    page = _get_html(clean_id)
    name = _match(page, r'class="player-title"[^>]*>(.*?)</h1>')
    page_id = _match(page, r'class="profile-info-id[^\"]*"[^>]*>(.*?)</p>')
    if not name or page_id != clean_id:
        raise LookupError("No existe una ficha pública válida con ese ID FIDE.")
    federation = _match(page, r'class="profile-info-country[^\"]*"[^>]*>(.*?)</div>')
    title = _match(page, r'class="profile-info-title[^\"]*"[^>]*>.*?<p>(.*?)</p>')
    if title:
        title = TITLE_CODES.get(title.casefold(), title)
    return FidePlayer(
        fide_id=clean_id,
        name=name,
        federation=federation,
        title=title,
        standard_rating=_rating(page, "profile-standart"),
        rapid_rating=_rating(page, "profile-rapid"),
        blitz_rating=_rating(page, "profile-blitz"),
        rating_history=_get_rating_history(clean_id) if include_history else [],
        profile_url=f"{BASE_URL}/profile/{clean_id}",
    )


def _download_rating_list(discipline: EloDiscipline, timeout: int = 30) -> bytes:
    now = time.monotonic()
    cached = _rating_list_cache.get(discipline)
    if cached and now - cached[0] < RATING_LIST_CACHE_SECONDS:
        return cached[1]
    with _rating_list_lock:
        cached = _rating_list_cache.get(discipline)
        if cached and now - cached[0] < RATING_LIST_CACHE_SECONDS:
            return cached[1]
        request = Request(
            RATING_LIST_URLS[discipline],
            headers={"Accept": "application/zip", "User-Agent": USER_AGENT},
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                body = response.read(MAX_RATING_LIST_BYTES + 1)
        except (HTTPError, URLError, TimeoutError) as exc:
            if cached:
                return cached[1]
            raise ProviderUnavailable(
                "No se pudo descargar la lista mensual oficial de FIDE."
            ) from exc
        if len(body) > MAX_RATING_LIST_BYTES:
            raise ProviderUnavailable("La lista mensual de FIDE supera el límite permitido.")
        if not body.startswith(b"PK"):
            raise ProviderUnavailable("FIDE no devolvió una lista mensual válida.")
        _rating_list_cache[discipline] = (now, body)
        return body


def _rating_list_columns(header: str) -> tuple[int, int, int, int, int]:
    name_start = header.find("Name")
    rating_match = re.search(r"\b[A-Z]{3}\d{2}\b", header)
    games_match = re.search(r"\bGms\b", header)
    k_match = re.search(r"\bK\b", header[games_match.end():] if games_match else "")
    birthday_start = header.find("B-day")
    if (
        name_start < 1
        or not rating_match
        or not games_match
        or not k_match
        or birthday_start < 1
    ):
        raise ProviderUnavailable("El formato de la lista mensual de FIDE ha cambiado.")
    k_start = games_match.end() + k_match.start()
    return name_start, rating_match.start(), games_match.start(), k_start, birthday_start


def get_current_rating_data(
    fide_ids: list[str], discipline: EloDiscipline
) -> dict[str, dict[str, int]]:
    requested = {fide_id.strip() for fide_id in fide_ids}
    if not requested or any(not re.fullmatch(r"\d{5,10}", value) for value in requested):
        raise LookupError("Los ID FIDE deben contener entre 5 y 10 cifras.")
    archive_bytes = _download_rating_list(discipline)
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            entries = [entry for entry in archive.infolist() if not entry.is_dir()]
            if (
                len(entries) != 1
                or entries[0].file_size > MAX_RATING_LIST_UNCOMPRESSED_BYTES
                or not entries[0].filename.casefold().endswith(".txt")
                or "/" in entries[0].filename.replace("\\", "/")
            ):
                raise ProviderUnavailable("El archivo mensual de FIDE no es válido.")
            with archive.open(entries[0]) as raw, io.TextIOWrapper(
                raw, encoding="utf-8-sig", errors="replace", newline=""
            ) as text_stream:
                header = text_stream.readline().rstrip("\r\n")
                name_start, rating_start, games_start, k_start, birthday_start = (
                    _rating_list_columns(header)
                )
                found: dict[str, dict[str, int]] = {}
                for line in text_stream:
                    fide_id = line[:name_start].strip()
                    if fide_id not in requested:
                        continue
                    rating_raw = line[rating_start:games_start].strip()
                    k_raw = line[k_start:birthday_start].strip()
                    if rating_raw.isdigit() and k_raw.isdigit():
                        found[fide_id] = {
                            "rating": int(rating_raw),
                            "k": int(k_raw),
                        }
                    if len(found) == len(requested):
                        break
                return found
    except (OSError, UnicodeError, zipfile.BadZipFile) as exc:
        raise ProviderUnavailable("No se pudo leer la lista mensual de FIDE.") from exc


def get_historical_rating(
    fide_id: str, discipline: EloDiscipline, period: str
) -> dict[str, int | str | bool | None]:
    clean_id = fide_id.strip()
    if not re.fullmatch(r"\d{5,10}", clean_id):
        raise LookupError("El ID FIDE debe contener entre 5 y 10 cifras.")
    match = re.fullmatch(r"(\d{4})-(0[1-9]|1[0-2])", period)
    if not match:
        raise LookupError("El periodo debe tener el formato AAAA-MM.")
    fide_period = f"{match.group(1)}-{month_abbr[int(match.group(2))]}"
    history = _get_rating_history(clean_id, period=0, max_points=None, strict=True)
    point = next((item for item in history if item.date == fide_period), None)
    if not point:
        return {
            "period": period,
            "rating": None,
            "rating_source": discipline.value,
            "standard_fallback": False,
        }
    field = {
        EloDiscipline.STANDARD: "rating",
        EloDiscipline.RAPID: "rapid_rating",
        EloDiscipline.BLITZ: "blitz_rating",
    }[discipline]
    rating = getattr(point, field)
    # Missing rapid/blitz Elo counts as 0; do not fall back to standard.
    if rating is None and discipline != EloDiscipline.STANDARD:
        rating = 0
    return {
        "period": period,
        "rating": rating,
        "rating_source": discipline.value,
        "standard_fallback": False,
    }


def _normalise_name(value: str) -> list[str]:
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").casefold()
    return re.findall(r"[a-z0-9]+", folded)


def names_match(official_name: str, pgn_name: str) -> bool:
    official = _normalise_name(official_name)
    candidate = _normalise_name(pgn_name)
    if len(official) < 2 or len(candidate) < 2:
        return False
    if set(official) == set(candidate):
        return True
    # Accept common PGN abbreviations such as "Carlsen, M" while requiring a
    # full shared surname and a compatible initial for the remaining name.
    shared_full = {token for token in official if len(token) >= 3} & {
        token for token in candidate if len(token) >= 3
    }
    if not shared_full:
        return False
    unmatched_official = [token for token in official if token not in shared_full]
    unmatched_candidate = [token for token in candidate if token not in shared_full]
    if not unmatched_official or not unmatched_candidate:
        return False
    return all(
        any(left.startswith(right) or right.startswith(left) for right in unmatched_official)
        for left in unmatched_candidate
    )


def verified_color(game: NormalizedGame, player: FidePlayer) -> str | None:
    if game.white_fide_id or game.black_fide_id:
        if game.white_fide_id == player.fide_id:
            return "white"
        if game.black_fide_id == player.fide_id:
            return "black"
        return None
    if names_match(player.name, game.white):
        return "white"
    if names_match(player.name, game.black):
        return "black"
    return None
