from __future__ import annotations

import os
import hashlib
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.app.models import CombinedPlayerCreate, DatasetCreate, GameType, Mode, Pace, PlayerRef
from api.app.providers.chesscom import (
    ProviderUnavailable as ChessComUnavailable,
    fetch_games as fetch_chesscom_games,
    get_player as get_chesscom_player,
)
from api.app.providers.lichess import (
    ProviderUnavailable as LichessUnavailable,
    fetch_games as fetch_lichess_games,
    get_player as get_lichess_player,
)
from api.app.providers.fide import (
    ProviderUnavailable as FideUnavailable,
    get_player as get_fide_player,
    verified_color,
)
from api.app.services.pgn import parse_pgn
from api.app.services.stats import calculate_stats, filter_games
from api.app.services.store import store


app = FastAPI(
    title="ChessPrep API",
    version="1.0.0",
    description="API determinista para preparar torneos con partidas PGN trazables.",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

origins = [
    item.strip()
    for item in os.getenv(
        "CHESSPREP_CORS_ORIGINS", "http://localhost:3000,http://localhost:8000"
    ).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).resolve().parent / "data"
DEMO_PLAYER = PlayerRef(
    source="demo",
    external_id="judit-polgar",
    username="Judit Polgar",
    display_name="Judit Polgár",
    title="GM",
    rating=2675,
    country="HU",
    game_type=GameType.ONLINE,
)


def ensure_demo():
    existing = store.get_for_player(DEMO_PLAYER.source, DEMO_PLAYER.external_id)
    if existing:
        return existing
    online = parse_pgn(
        (DATA_DIR / "demo_online.pgn").read_text(encoding="utf-8"),
        source="lichess",
        game_type=GameType.ONLINE,
        target_player="Judit Polgar",
        confidence="official",
    )
    otb = parse_pgn(
        (DATA_DIR / "demo_otb.pgn").read_text(encoding="utf-8"),
        source="pgn_import",
        game_type=GameType.OTB,
        target_player="Judit Polgar",
        confidence="user_upload",
    )
    return store.create(DEMO_PLAYER, [*online.games, *otb.games], dataset_id="demo-judit-polgar")


def get_dataset_or_404(source: str, external_id: str):
    if source == "demo" and external_id == DEMO_PLAYER.external_id:
        return ensure_demo()
    dataset = store.get_for_player(source, external_id)
    if dataset:
        return dataset
    if source not in {"lichess", "chess.com"}:
        raise HTTPException(status_code=404, detail="No se encontró el conjunto temporal.")
    try:
        if source == "lichess":
            player = get_lichess_player(external_id)
            parsed = fetch_lichess_games(player.username)
        else:
            player = get_chesscom_player(external_id)
            parsed = fetch_chesscom_games(player.username)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (LichessUnavailable, ChessComUnavailable) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not parsed.games:
        raise HTTPException(status_code=422, detail="Lichess no devolvió partidas públicas utilizables.")
    return store.create(player, parsed.games)


def create_combined_player_dataset(payload: CombinedPlayerCreate, max_games: int = 30):
    handles = [payload.lichess_username, payload.chesscom_username]
    if not any(value and value.strip() for value in handles):
        raise HTTPException(status_code=422, detail="Indica al menos un usuario de Lichess o Chess.com.")

    players: list[PlayerRef] = []
    games = []
    warnings: list[str] = []
    requested = 0

    if payload.lichess_username and payload.lichess_username.strip():
        requested += 1
        handle = payload.lichess_username.strip()
        try:
            player = get_lichess_player(handle)
            parsed = fetch_lichess_games(player.username, max_games=max_games)
            players.append(player)
            games.extend(parsed.games)
            warnings.extend(parsed.errors)
        except (LookupError, LichessUnavailable) as exc:
            warnings.append(f"Lichess: {exc}")

    if payload.chesscom_username and payload.chesscom_username.strip():
        requested += 1
        handle = payload.chesscom_username.strip()
        try:
            player = get_chesscom_player(handle)
            parsed = fetch_chesscom_games(player.username, max_games=max_games)
            players.append(player)
            games.extend(parsed.games)
            warnings.extend(parsed.errors)
        except (LookupError, ChessComUnavailable) as exc:
            warnings.append(f"Chess.com: {exc}")

    if not games:
        detail = " ".join(warnings) or "Ninguna plataforma devolvió partidas públicas."
        raise HTTPException(status_code=422, detail=detail)

    unique_games = {}
    for game in games:
        unique_games.setdefault(game.dedupe_hash, game)
    duplicates = len(games) - len(unique_games)
    identifier_source = "|".join(value.strip().casefold() for value in handles if value and value.strip())
    external_id = hashlib.sha256(identifier_source.encode("utf-8")).hexdigest()[:16]
    display_player = next((player for player in players if " " in player.display_name), players[0])
    combined_player = PlayerRef(
        source="combined",
        external_id=external_id,
        username=" + ".join(player.username for player in players),
        display_name=display_player.display_name,
        title=next((player.title for player in players if player.title), None),
        rating=max((player.rating for player in players if player.rating), default=None),
        country=next((player.country for player in players if player.country), None),
        avatar_url=next((player.avatar_url for player in players if player.avatar_url), None),
        game_type=GameType.ONLINE,
    )
    dataset = store.create(combined_player, list(unique_games.values()))
    if len(players) < requested:
        warnings.append("El dossier se creó con las plataformas que sí estaban disponibles.")
    return dataset, warnings, duplicates


def trace_for(dataset, games, mode: Mode, pace: Pace):
    dates = sorted(game.date for game in games if game.date)
    return {
        "sample_size": len(games),
        "sources": sorted({game.source for game in games}),
        "mode": mode.value,
        "pace": pace.value,
        "date_range": {"from": dates[0] if dates else None, "to": dates[-1] if dates else None},
        "dataset_id": dataset.dataset_id,
        "expires_at": dataset.expires_at,
    }


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "service": "chessprep-api", "version": app.version}


@app.get("/api/v1/demo")
def demo():
    dataset = ensure_demo()
    return {
        "player": dataset.player,
        "dataset_id": dataset.dataset_id,
        "games": len(dataset.games),
        "expires_at": dataset.expires_at,
    }


@app.get("/api/v1/players/search")
def search_players(q: str = Query(min_length=2, max_length=80), source: str = "all"):
    clean = q.strip()
    demo_match = clean.casefold() in {
        "judit",
        "judit polgar",
        "judit polgár",
        "demo",
        "muestra",
    }
    results = [DEMO_PLAYER] if demo_match else []
    messages: list[str] = []
    available = False
    if source in {"lichess", "all"}:
        try:
            player = get_lichess_player(clean)
            results.append(player)
            available = True
        except LookupError:
            messages.append("No se encontró una cuenta exacta en Lichess.")
            available = True
        except LichessUnavailable as exc:
            messages.append(str(exc))
    if source in {"chess.com", "all"}:
        try:
            player = get_chesscom_player(clean)
            results.append(player)
            available = True
        except LookupError:
            messages.append("No se encontró una cuenta exacta en Chess.com.")
            available = True
        except ChessComUnavailable as exc:
            messages.append(str(exc))
    return {
        "results": results,
        "provider_available": available,
        "message": " ".join(messages) or None,
    }


@app.post("/api/v1/players/combined")
def combine_players(payload: CombinedPlayerCreate, max_games: int = Query(100, ge=1, le=100)):
    dataset, warnings, duplicates = create_combined_player_dataset(payload, max_games=max_games)
    return {"dataset": dataset, "warnings": warnings, "duplicates": duplicates}


@app.get("/api/v1/players/{source}/{external_id}")
def player_detail(source: str, external_id: str):
    if source == "demo" and external_id == DEMO_PLAYER.external_id:
        return ensure_demo().player
    existing = store.get_for_player(source, external_id)
    if existing:
        return existing.player
    if source not in {"lichess", "chess.com"}:
        raise HTTPException(status_code=404, detail="Jugador no encontrado.")
    try:
        return get_lichess_player(external_id) if source == "lichess" else get_chesscom_player(external_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (LichessUnavailable, ChessComUnavailable) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/players/{source}/{external_id}/refresh-games")
def refresh_games(source: str, external_id: str, max_games: int = Query(100, ge=1, le=100)):
    if source == "demo":
        dataset = ensure_demo()
        return {"dataset": dataset, "warnings": [], "duplicates": 0}
    if source not in {"lichess", "chess.com"}:
        raise HTTPException(status_code=400, detail="El proveedor indicado no admite actualización.")
    try:
        if source == "lichess":
            player = get_lichess_player(external_id)
            parsed = fetch_lichess_games(player.username, max_games=max_games)
        else:
            player = get_chesscom_player(external_id)
            parsed = fetch_chesscom_games(player.username, max_games=max_games)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (LichessUnavailable, ChessComUnavailable) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not parsed.games:
        raise HTTPException(status_code=422, detail="No se encontraron partidas públicas válidas.")
    dataset = store.create(player, parsed.games)
    return {"dataset": dataset, "warnings": parsed.errors, "duplicates": parsed.duplicates}


@app.get("/api/v1/players/{source}/{external_id}/games")
def player_games(
    source: str,
    external_id: str,
    mode: Mode = Mode.COMBINED,
    pace: Pace = Pace.GLOBAL,
    color: str | None = None,
    eco: str | None = None,
    result: str | None = None,
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=250),
):
    dataset = get_dataset_or_404(source, external_id)
    games = filter_games(
        dataset.games,
        mode=mode,
        pace=pace,
        color=color,
        eco=eco,
        result=result,
        date_from=date_from,
        date_to=date_to,
    )
    start = (page - 1) * page_size
    return {
        "items": games[start : start + page_size],
        "total": len(games),
        "page": page,
        "page_size": page_size,
        "trace": trace_for(dataset, games, mode, pace),
    }


@app.get("/api/v1/players/{source}/{external_id}/stats")
def player_stats(
    source: str,
    external_id: str,
    mode: Mode = Mode.COMBINED,
    pace: Pace = Pace.GLOBAL,
):
    dataset = get_dataset_or_404(source, external_id)
    return calculate_stats(dataset.games, mode, pace)


@app.get("/api/v1/players/{source}/{external_id}/stats/by-color")
def player_stats_by_color(
    source: str,
    external_id: str,
    mode: Mode = Mode.COMBINED,
    pace: Pace = Pace.GLOBAL,
):
    dataset = get_dataset_or_404(source, external_id)
    stats = calculate_stats(dataset.games, mode, pace)
    return {key: stats[key] for key in ("mode", "pace", "sample_size", "sources", "date_range", "by_color")}


@app.get("/api/v1/players/{source}/{external_id}/stats/openings")
def player_stats_openings(
    source: str,
    external_id: str,
    mode: Mode = Mode.COMBINED,
    pace: Pace = Pace.GLOBAL,
    color: str | None = None,
):
    dataset = get_dataset_or_404(source, external_id)
    stats = calculate_stats(dataset.games, mode, pace)
    openings = stats["openings"]
    if color:
        openings = [item for item in openings if item["color"] == color]
    return {
        "mode": stats["mode"],
        "pace": stats["pace"],
        "sample_size": stats["sample_size"],
        "sources": stats["sources"],
        "date_range": stats["date_range"],
        "openings": openings,
    }


@app.get("/api/v1/games/{source}/{game_id}")
def game_detail(source: str, game_id: str):
    ensure_demo()
    game = store.find_game(source, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Partida no encontrada o conjunto caducado.")
    return game


@app.get("/api/v1/fide/players/{fide_id}")
def fide_player_detail(fide_id: str):
    try:
        return get_fide_player(fide_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FideUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/datasets", status_code=201)
def create_dataset(payload: DatasetCreate):
    base_dataset = None
    if payload.merge_with_dataset_id:
        base_dataset = store.get(payload.merge_with_dataset_id)
        if not base_dataset:
            raise HTTPException(status_code=404, detail="El dossier que querías ampliar ha caducado.")

    if payload.game_type != GameType.OTB:
        raise HTTPException(status_code=422, detail="Este importador solo admite partidas OTB.")
    if not payload.fide_id:
        raise HTTPException(
            status_code=422,
            detail="Para importar partidas OTB necesitas un ID FIDE válido.",
        )
    try:
        fide_player = get_fide_player(payload.fide_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FideUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    parsed = parse_pgn(
        payload.pgn,
        source="pgn_import",
        game_type=payload.game_type,
        target_player=fide_player.name,
        confidence="user_upload",
    )
    if not parsed.games:
        detail = parsed.errors[0] if parsed.errors else "No se pudo procesar el PGN."
        raise HTTPException(status_code=422, detail=detail)

    verified_games = []
    rejected_games = 0
    for game in parsed.games:
        color = verified_color(game, fide_player)
        if not color:
            rejected_games += 1
            continue
        verified_games.append(
            game.model_copy(update={"player_color": color, "target_player": fide_player.name})
        )
    if not verified_games:
        raise HTTPException(
            status_code=422,
            detail=(
                f"El PGN no contiene partidas verificables de {fide_player.name} "
                f"(ID FIDE {fide_player.fide_id})."
            ),
        )
    warnings = list(parsed.errors)
    if rejected_games:
        warnings.append(
            f"Se omitieron {rejected_games} partidas porque el jugador FIDE no figuraba en sus cabeceras."
        )

    if base_dataset:
        merged_games = {}
        for game in [*base_dataset.games, *verified_games]:
            merged_games.setdefault(game.dedupe_hash, game)
        cross_duplicates = len(base_dataset.games) + len(verified_games) - len(merged_games)
        identity = f"{base_dataset.player.source}|{base_dataset.player.external_id}|otb"
        merged_player = base_dataset.player.model_copy(
            update={
                "source": "combined",
                "external_id": hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16],
                "display_name": fide_player.name,
                "title": base_dataset.player.title or fide_player.title,
                "rating": base_dataset.player.rating or fide_player.standard_rating,
                "country": base_dataset.player.country or fide_player.federation,
                "fide_id": fide_player.fide_id,
            }
        )
        dataset = store.create(merged_player, list(merged_games.values()))
        return {
            "dataset": dataset,
            "fide_player": fide_player,
            "warnings": warnings,
            "duplicates": parsed.duplicates + cross_duplicates,
            "rejected_games": rejected_games,
            "merged_games": len(verified_games) - cross_duplicates,
        }

    player = PlayerRef(
        source="fide",
        external_id=fide_player.fide_id,
        username=fide_player.name,
        display_name=fide_player.name,
        title=fide_player.title,
        rating=fide_player.standard_rating,
        country=fide_player.federation,
        fide_id=fide_player.fide_id,
        game_type=payload.game_type,
    )
    dataset = store.create(player, verified_games)
    return {
        "dataset": dataset,
        "fide_player": fide_player,
        "warnings": warnings,
        "duplicates": parsed.duplicates,
        "rejected_games": rejected_games,
        "merged_games": len(verified_games),
    }


@app.get("/api/v1/datasets/{dataset_id}/games")
def dataset_games(
    dataset_id: str,
    mode: Mode = Mode.COMBINED,
    pace: Pace = Pace.GLOBAL,
):
    dataset = store.get(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset no encontrado o caducado.")
    games = filter_games(dataset.games, mode=mode, pace=pace)
    return {"items": games, "total": len(games), "trace": trace_for(dataset, games, mode, pace)}


@app.get("/api/v1/datasets/{dataset_id}/stats")
def dataset_stats(
    dataset_id: str,
    mode: Mode = Mode.COMBINED,
    pace: Pace = Pace.GLOBAL,
):
    dataset = store.get(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset no encontrado o caducado.")
    return calculate_stats(dataset.games, mode, pace)


web_dir = Path(os.getenv("CHESSPREP_WEB_DIR", Path(__file__).resolve().parents[2] / "web"))
if web_dir.exists():
    app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")
