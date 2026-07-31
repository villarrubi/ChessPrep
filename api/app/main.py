from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.app.models import DatasetCreate, GameType, Mode, PlayerRef
from api.app.providers.lichess import ProviderUnavailable, fetch_games, get_player
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
    if source != "lichess":
        raise HTTPException(status_code=404, detail="No se encontró el conjunto temporal.")
    try:
        player = get_player(external_id)
        parsed = fetch_games(player.username)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not parsed.games:
        raise HTTPException(status_code=422, detail="Lichess no devolvió partidas públicas utilizables.")
    return store.create(player, parsed.games)


def trace_for(dataset, games, mode: Mode):
    dates = sorted(game.date for game in games if game.date)
    return {
        "sample_size": len(games),
        "sources": sorted({game.source for game in games}),
        "mode": mode.value,
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
def search_players(q: str = Query(min_length=2, max_length=80), source: str = "lichess"):
    clean = q.strip()
    demo_match = clean.casefold() in {
        "judit",
        "judit polgar",
        "judit polgár",
        "demo",
        "muestra",
    }
    results = [DEMO_PLAYER] if demo_match else []
    if source not in {"lichess", "all"}:
        return {"results": results, "provider_available": True}
    try:
        player = get_player(clean)
        if not any(item.external_id == player.external_id and item.source == player.source for item in results):
            results.append(player)
        return {"results": results, "provider_available": True}
    except LookupError:
        return {
            "results": results,
            "provider_available": True,
            "message": "No se encontró una cuenta exacta en Lichess.",
        }
    except ProviderUnavailable as exc:
        return {"results": results, "provider_available": False, "message": str(exc)}


@app.get("/api/v1/players/{source}/{external_id}")
def player_detail(source: str, external_id: str):
    if source == "demo" and external_id == DEMO_PLAYER.external_id:
        return ensure_demo().player
    existing = store.get_for_player(source, external_id)
    if existing:
        return existing.player
    if source != "lichess":
        raise HTTPException(status_code=404, detail="Jugador no encontrado.")
    try:
        return get_player(external_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/players/{source}/{external_id}/refresh-games")
def refresh_games(source: str, external_id: str, max_games: int = Query(30, ge=1, le=100)):
    if source == "demo":
        dataset = ensure_demo()
        return {"dataset": dataset, "warnings": [], "duplicates": 0}
    if source != "lichess":
        raise HTTPException(status_code=400, detail="El proveedor indicado no admite actualización.")
    try:
        player = get_player(external_id)
        parsed = fetch_games(player.username, max_games=max_games)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProviderUnavailable as exc:
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
    color: str | None = None,
    eco: str | None = None,
    result: str | None = None,
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    dataset = get_dataset_or_404(source, external_id)
    games = filter_games(
        dataset.games,
        mode=mode,
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
        "trace": trace_for(dataset, games, mode),
    }


@app.get("/api/v1/players/{source}/{external_id}/stats")
def player_stats(source: str, external_id: str, mode: Mode = Mode.COMBINED):
    dataset = get_dataset_or_404(source, external_id)
    return calculate_stats(dataset.games, mode)


@app.get("/api/v1/players/{source}/{external_id}/stats/by-color")
def player_stats_by_color(source: str, external_id: str, mode: Mode = Mode.COMBINED):
    dataset = get_dataset_or_404(source, external_id)
    stats = calculate_stats(dataset.games, mode)
    return {key: stats[key] for key in ("mode", "sample_size", "sources", "date_range", "by_color")}


@app.get("/api/v1/players/{source}/{external_id}/stats/openings")
def player_stats_openings(
    source: str,
    external_id: str,
    mode: Mode = Mode.COMBINED,
    color: str | None = None,
):
    dataset = get_dataset_or_404(source, external_id)
    stats = calculate_stats(dataset.games, mode)
    openings = stats["openings"]
    if color:
        openings = [item for item in openings if item["color"] == color]
    return {
        "mode": stats["mode"],
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


@app.post("/api/v1/datasets", status_code=201)
def create_dataset(payload: DatasetCreate):
    parsed = parse_pgn(
        payload.pgn,
        source="pgn_import",
        game_type=payload.game_type,
        target_player=payload.target_player,
        confidence="user_upload",
    )
    if not parsed.games:
        detail = parsed.errors[0] if parsed.errors else "No se pudo procesar el PGN."
        raise HTTPException(status_code=422, detail=detail)
    target = payload.target_player or parsed.games[0].target_player
    slug = re.sub(r"[^a-z0-9]+", "-", target.casefold()).strip("-") or "jugador-importado"
    player = PlayerRef(
        source="upload",
        external_id=f"{slug}-{parsed.games[0].dedupe_hash[:6]}",
        username=target,
        display_name=target,
        game_type=payload.game_type,
    )
    dataset = store.create(player, parsed.games)
    return {
        "dataset": dataset,
        "warnings": parsed.errors,
        "duplicates": parsed.duplicates,
    }


@app.get("/api/v1/datasets/{dataset_id}/games")
def dataset_games(dataset_id: str, mode: Mode = Mode.COMBINED):
    dataset = store.get(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset no encontrado o caducado.")
    games = filter_games(dataset.games, mode=mode)
    return {"items": games, "total": len(games), "trace": trace_for(dataset, games, mode)}


@app.get("/api/v1/datasets/{dataset_id}/stats")
def dataset_stats(dataset_id: str, mode: Mode = Mode.COMBINED):
    dataset = store.get(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset no encontrado o caducado.")
    return calculate_stats(dataset.games, mode)


web_dir = Path(os.getenv("CHESSPREP_WEB_DIR", Path(__file__).resolve().parents[2] / "web"))
if web_dir.exists():
    app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")

