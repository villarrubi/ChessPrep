from __future__ import annotations

import hashlib
import html
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from api.app.models import FidePlayer, Info64Result
from api.app.services.text import clean_untrusted_text


BASE_URL = "https://info64.org"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 "
    "ChessPrep/1.0"
)
MAX_RESPONSE_BYTES = 4_000_000
MAX_TOURNAMENTS = max(1, min(int(os.getenv("CHESSPREP_INFO64_MAX_TOURNAMENTS", "30")), 100))
_VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


class ProviderUnavailable(RuntimeError):
    pass


def _allowed_info64_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return bool(
            parsed.scheme == "https"
            and parsed.hostname == "info64.org"
            and parsed.port in {None, 443}
            and not parsed.username
            and not parsed.password
        )
    except ValueError:
        return False


class _Info64RedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _allowed_info64_url(newurl):
            raise ProviderUnavailable("Info64 intentó redirigir la consulta fuera de su dominio.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = build_opener(_Info64RedirectHandler())


@dataclass
class _Link:
    href: str
    text_parts: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return clean_untrusted_text(" ".join(self.text_parts), max_length=240)


@dataclass
class _Cell:
    text_parts: list[str] = field(default_factory=list)
    links: list[_Link] = field(default_factory=list)
    classes: set[str] = field(default_factory=set)
    is_header: bool = False

    @property
    def text(self) -> str:
        return clean_untrusted_text(" ".join(self.text_parts), max_length=500)


@dataclass
class _Table:
    table_id: str | None
    container_ids: set[str]
    rows: list[list[_Cell]] = field(default_factory=list)


@dataclass(frozen=True)
class _Candidate:
    player_path: str
    tournament_path: str
    player_name: str
    tournament_name: str
    start_date: str | None
    end_date: str | None


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, str | None]] = []
        self.tables: list[_Table] = []
        self.table: _Table | None = None
        self.row: list[_Cell] | None = None
        self.cell: _Cell | None = None
        self.link: _Link | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.casefold(): value or "" for key, value in attrs}
        element_id = values.get("id") or None
        if tag == "table" and self.table is None:
            containers = {item_id for _, item_id in self.stack if item_id}
            self.table = _Table(element_id, containers)
        elif self.table is not None and tag == "tr":
            self.row = []
        elif self.table is not None and self.row is not None and tag in {"td", "th"}:
            self.cell = _Cell(
                classes=set(values.get("class", "").casefold().split()),
                is_header=tag == "th",
            )
        elif self.cell is not None and tag == "a":
            self.link = _Link(values.get("href", ""))
            self.cell.links.append(self.link)
        if tag not in _VOID_TAGS:
            self.stack.append((tag, element_id))

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self.link = None
        elif tag in {"td", "th"} and self.row is not None and self.cell is not None:
            self.row.append(self.cell)
            self.cell = None
            self.link = None
        elif tag == "tr" and self.table is not None and self.row is not None:
            if self.row:
                self.table.rows.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None
            self.row = None
            self.cell = None
            self.link = None
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if self.cell is None:
            return
        self.cell.text_parts.append(data)
        if self.link is not None:
            self.link.text_parts.append(data)


def _tables(page: str) -> list[_Table]:
    parser = _TableParser()
    parser.feed(page)
    parser.close()
    return parser.tables


def _safe_relative_path(value: str) -> str | None:
    candidate = html.unescape(value or "").strip()
    if not candidate or "\\" in candidate or any(ord(char) < 32 for char in candidate):
        return None
    parsed = urlsplit(candidate)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
        return None
    if any(part in {".", ".."} for part in parsed.path.split("/")):
        return None
    query = urlencode(parse_qsl(parsed.query, keep_blank_values=True))
    return parsed.path + (f"?{query}" if query else "")


def _get_html(path: str, timeout: int = 18) -> str:
    safe_path = _safe_relative_path(path)
    if not safe_path:
        raise ProviderUnavailable("Info64 devolvió una ruta no permitida.")
    request = Request(
        f"{BASE_URL}{safe_path}",
        headers={"Accept": "text/html", "User-Agent": USER_AGENT},
    )
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            if not _allowed_info64_url(response.geturl()):
                raise ProviderUnavailable("Info64 redirigió la consulta fuera de su dominio.")
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ProviderUnavailable("La respuesta de Info64 supera el límite permitido.")
            return body.decode("utf-8", errors="replace")
    except HTTPError as exc:
        if exc.code == 404:
            raise LookupError("Info64 no encontró esa participación.") from exc
        if exc.code == 429:
            raise ProviderUnavailable("Info64 ha limitado temporalmente las consultas.") from exc
        raise ProviderUnavailable(f"Info64 respondió con el estado {exc.code}.") from exc
    except (URLError, TimeoutError) as exc:
        raise ProviderUnavailable("No se pudo conectar con Info64.") from exc


def _iso_date(value: str) -> str | None:
    match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", value or "")
    if not match:
        return None
    try:
        date.fromisoformat(match.group(1))
    except ValueError:
        return None
    return match.group(1)


def _overlaps(start: str | None, end: str | None, date_from: date | None, date_to: date | None) -> bool:
    start_value = date.fromisoformat(start) if start else None
    end_value = date.fromisoformat(end) if end else start_value
    if date_from and end_value and end_value < date_from:
        return False
    if date_to and start_value and start_value > date_to:
        return False
    return True


def _normalise_header(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", folded.casefold())


def _relative_link(cell: _Cell) -> _Link | None:
    return next((link for link in cell.links if _safe_relative_path(link.href)), None)


def _search_candidates(
    player_name: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[list[_Candidate], str]:
    query = urlencode({"name": player_name, "hl": "en"})
    search_path = f"/search-player?{query}"
    page = _get_html(search_path)
    search_table = next(
        (table for table in _tables(page) if "search-results" in table.container_ids),
        None,
    )
    if search_table is None:
        if "search-results" in page:
            return [], f"{BASE_URL}{search_path}"
        raise ProviderUnavailable("Info64 cambió el formato de su buscador de jugadores.")

    candidates: list[_Candidate] = []
    seen: set[str] = set()
    for row in search_table.rows:
        if len(row) < 6 or any(cell.is_header for cell in row):
            continue
        player_link = _relative_link(row[1])
        tournament_link = _relative_link(row[3])
        if not player_link or not tournament_link:
            continue
        player_path = _safe_relative_path(player_link.href)
        tournament_path = _safe_relative_path(tournament_link.href)
        if not player_path or not tournament_path or player_path in seen:
            continue
        start = _iso_date(row[4].text)
        end = _iso_date(row[5].text)
        if not _overlaps(start, end, date_from, date_to):
            continue
        seen.add(player_path)
        candidates.append(
            _Candidate(
                player_path=player_path.split("?", 1)[0],
                tournament_path=tournament_path.split("?", 1)[0].rstrip("/"),
                player_name=player_link.text or row[1].text,
                tournament_name=tournament_link.text or row[3].text,
                start_date=start,
                end_date=end,
            )
        )
    candidates.sort(key=lambda item: item.end_date or item.start_date or "", reverse=True)
    return candidates[:MAX_TOURNAMENTS], f"{BASE_URL}{search_path}"


def _page_has_fide_id(page: str, fide_id: str) -> bool:
    summary = re.split(r"id\s*=\s*['\"]player-results['\"]", page, maxsplit=1, flags=re.IGNORECASE)[0]
    return bool(
        re.search(
            rf"https?://ratings\.fide\.com/profile/{re.escape(fide_id)}(?:['\"?#/]|$)",
            summary,
            flags=re.IGNORECASE,
        )
    )


def _schedule(tournament_path: str) -> dict[str, tuple[str, str | None]]:
    page = _get_html(f"{tournament_path}/schedule?hl=en")
    schedule: dict[str, tuple[str, str | None]] = {}
    for table in _tables(page):
        for row in table.rows:
            text = " ".join(cell.text for cell in row)
            day = _iso_date(text)
            if not day:
                continue
            round_match = re.search(r"\b(?:round|rd\.?|ronda)\s*(\d+(?:\.\d+)?)\b", text, re.IGNORECASE)
            if not round_match:
                for cell in row:
                    for link in cell.links:
                        path = _safe_relative_path(link.href)
                        if path:
                            round_match = re.search(r"/(\d+(?:\.\d+)?)$", path.split("?", 1)[0])
                            if round_match:
                                break
                    if round_match:
                        break
            if not round_match:
                continue
            time_match = re.search(r"\b([01]\d|2[0-3]):[0-5]\d\b", text)
            schedule[round_match.group(1)] = (day, time_match.group(0) if time_match else None)
    return schedule


def _index(headers: dict[str, int], *names: str, default: int | None = None) -> int | None:
    for name in names:
        if name in headers:
            return headers[name]
    return default


def _result_value(raw: str) -> tuple[str, float, bool] | None:
    value = raw.strip().replace(",", ".")
    compact = re.sub(r"\s+", "", value)
    if compact in {"1", "+", "1.0"}:
        return "win", 1.0, compact == "+"
    if compact in {"0", "-", "0.0"}:
        return "loss", 0.0, compact == "-"
    if compact in {"0.5", "1/2", "½", "="}:
        return "draw", 0.5, False
    return None


def _parse_results(
    page: str,
    candidate: _Candidate,
    player: FidePlayer,
    round_dates: dict[str, tuple[str, str | None]],
    date_from: date | None,
    date_to: date | None,
) -> tuple[list[Info64Result], int]:
    table = next((item for item in _tables(page) if item.table_id == "player-results"), None)
    if table is None:
        raise ProviderUnavailable("Info64 cambió el formato de la tabla de resultados.")
    header_row = next((row for row in table.rows if any(cell.is_header for cell in row)), None)
    headers = {
        _normalise_header(cell.text): index
        for index, cell in enumerate(header_row or [])
        if cell.text
    }
    first_data_row = next(
        (row for row in table.rows if row and not any(cell.is_header for cell in row)),
        None,
    )
    federation_index = _index(headers, "fed", "federation", "federacion")
    if federation_index is None and first_data_row:
        federation_index = next(
            (
                index
                for index, cell in enumerate(first_data_row)
                if "playerfederation" in cell.classes
            ),
            None,
        )
    round_index = _index(headers, "rd", "round", "ronda", default=0)
    board_index = _index(headers, "brd", "board", "tablero", default=1)
    color_index = _index(headers, "col", "color", default=2)
    name_index = _index(
        headers,
        "name",
        "nombre",
        default=federation_index - 1 if federation_index is not None else 4,
    )
    rating_index = _index(
        headers,
        "fide",
        "rating",
        "elo",
        default=federation_index + 1 if federation_index is not None else 6,
    )
    result_index = _index(headers, "res", "result", "resultado")
    required = [round_index, name_index]
    if any(index is None for index in required):
        raise ProviderUnavailable("Info64 devolvió columnas de resultados no reconocidas.")

    results: list[Info64Result] = []
    ignored = 0
    for row in table.rows:
        if any(cell.is_header for cell in row) or max(index for index in required if index is not None) >= len(row):
            continue
        row_result_index = result_index if result_index is not None else len(row) - 2
        if row_result_index < 0 or row_result_index >= len(row):
            ignored += 1
            continue
        raw_result = row[row_result_index].text
        parsed_result = _result_value(raw_result)
        opponent_cell = row[name_index]  # type: ignore[index]
        opponent_link = _relative_link(opponent_cell)
        if not parsed_result:
            ignored += 1
            continue
        opponent_fide_id = None
        for link in opponent_cell.links:
            match = re.search(r"ratings\.fide\.com/profile/(\d{5,10})", link.href, re.IGNORECASE)
            if match:
                opponent_fide_id = match.group(1)
                break
        opponent_name = opponent_link.text if opponent_link else opponent_cell.text
        if opponent_fide_id and not opponent_link:
            opponent_name = re.sub(
                rf"\s*{re.escape(opponent_fide_id)}\s*$", "", opponent_name
            ).strip()
        if not opponent_name or opponent_name.casefold() in {"-", "--", "bye", "descanso"}:
            continue
        opponent_rating = None
        if rating_index is not None and rating_index < len(row):
            rating_match = re.search(r"\b(\d{3,4})\b", row[rating_index].text)
            opponent_rating = int(rating_match.group(1)) if rating_match else None
        round_value = row[round_index].text  # type: ignore[index]
        round_key_match = re.search(r"\d+(?:\.\d+)?", round_value)
        round_key = round_key_match.group(0) if round_key_match else round_value
        exact_date, exact_time = round_dates.get(round_key, (None, None))
        result_date = exact_date or candidate.start_date
        precision = "round" if exact_date else ("tournament" if result_date else "unknown")
        if exact_date:
            exact_day = date.fromisoformat(exact_date)
            if (date_from and exact_day < date_from) or (date_to and exact_day > date_to):
                continue
        elif not _overlaps(candidate.start_date, candidate.end_date, date_from, date_to):
            continue
        raw_color = row[color_index].text.casefold() if color_index is not None and color_index < len(row) else ""
        color = "white" if raw_color in {"w", "white", "blancas"} else "black" if raw_color in {"b", "black", "negras"} else None
        outcome, score, walkover = parsed_result
        board = row[board_index].text if board_index is not None and board_index < len(row) else None
        identity = "|".join((player.fide_id, candidate.tournament_path, round_key, opponent_fide_id or opponent_name))
        results.append(
            Info64Result(
                id=hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20],
                fide_id=player.fide_id,
                player_name=clean_untrusted_text(player.name),
                opponent_name=clean_untrusted_text(opponent_name),
                opponent_fide_id=opponent_fide_id,
                opponent_rating=opponent_rating,
                color=color,
                outcome=outcome,
                score=score,
                result=clean_untrusted_text(raw_result, max_length=12),
                round=clean_untrusted_text(round_value, max_length=30) or None,
                board=clean_untrusted_text(board, max_length=30) or None,
                date=result_date,
                time=exact_time,
                date_precision=precision,
                tournament=clean_untrusted_text(candidate.tournament_name),
                tournament_start=candidate.start_date,
                tournament_end=candidate.end_date,
                tournament_url=f"{BASE_URL}{candidate.tournament_path}",
                player_url=f"{BASE_URL}{candidate.player_path}",
                walkover=walkover,
            )
        )
    return results, ignored


def fetch_results(
    player: FidePlayer,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    candidates, source_url = _search_candidates(player.name, date_from, date_to)
    warnings: list[str] = []
    results: list[Info64Result] = []
    matched = 0
    candidate_failures = 0
    if len(candidates) == MAX_TOURNAMENTS:
        warnings.append(
            f"Info64 devolvió al menos {MAX_TOURNAMENTS} participaciones; se consultaron las más recientes."
        )
    for candidate in candidates:
        try:
            page = _get_html(f"{candidate.player_path}?hl=en")
            if not _page_has_fide_id(page, player.fide_id):
                continue
            matched += 1
            try:
                dates = _schedule(candidate.tournament_path)
            except (LookupError, ProviderUnavailable):
                dates = {}
                warnings.append(
                    f"{candidate.tournament_name}: no se pudo precisar la fecha de cada ronda."
                )
            parsed, ignored = _parse_results(page, candidate, player, dates, date_from, date_to)
            results.extend(parsed)
            if ignored:
                warnings.append(
                    f"{candidate.tournament_name}: se omitieron {ignored} filas sin rival o resultado reconocible."
                )
        except (LookupError, ProviderUnavailable) as exc:
            candidate_failures += 1
            warnings.append(f"{candidate.tournament_name}: {exc}")

    if candidates and candidate_failures == len(candidates):
        raise ProviderUnavailable(
            "Info64 encontró participaciones, pero no se pudo consultar ninguna de sus fichas."
        )
    if candidates and not matched:
        warnings.append(
            "Info64 encontró jugadores con el mismo nombre, pero ninguno tenía el ID FIDE solicitado."
        )

    unique = {result.id: result for result in results}
    ordered = sorted(
        unique.values(),
        key=lambda result: (result.date or "", result.tournament, result.round or ""),
        reverse=True,
    )
    return {
        "results": ordered,
        "warnings": list(dict.fromkeys(warnings)),
        "source_url": source_url,
        "tournaments_scanned": len(candidates),
        "tournaments_matched": matched,
    }
