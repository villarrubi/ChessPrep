from __future__ import annotations

import html
import re
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from api.app.models import FidePlayer, NormalizedGame


BASE_URL = "https://ratings.fide.com"
USER_AGENT = "ChessPrep/1.0 (FIDE identity verification; github.com/villarrubi/Chess-Tournament-Assistant)"
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
            return response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        if exc.code == 404:
            raise LookupError("No existe una ficha pública con ese ID FIDE.") from exc
        raise ProviderUnavailable(f"FIDE respondió con el estado {exc.code}.") from exc
    except (URLError, TimeoutError) as exc:
        raise ProviderUnavailable("No se pudo conectar con la base oficial de FIDE.") from exc


def _clean_fragment(fragment: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def _match(html_text: str, pattern: str) -> str | None:
    found = re.search(pattern, html_text, flags=re.IGNORECASE | re.DOTALL)
    return _clean_fragment(found.group(1)) if found else None


def _rating(html_text: str, css_class: str) -> int | None:
    value = _match(html_text, rf'class="{css_class}[^\"]*"[^>]*>.*?<p>(.*?)</p>')
    return int(value) if value and value.isdigit() else None


def get_player(fide_id: str) -> FidePlayer:
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
        profile_url=f"{BASE_URL}/profile/{clean_id}",
    )


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
