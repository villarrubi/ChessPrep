from __future__ import annotations

from fastapi import APIRouter, Query

from api.app.models import CombinedPlayerCreate, Mode, Pace
from api.app.services.container import ApplicationServices


def create_players_router(services: ApplicationServices) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    @router.get("/players/search")
    def search_players(
        q: str = Query(min_length=2, max_length=80),
        source: str = "all",
    ):
        return services.online_players.search(q, source)

    @router.post("/players/combined")
    def combine_players(
        payload: CombinedPlayerCreate,
        max_games: int = Query(100, ge=1, le=100),
    ):
        dataset, warnings, duplicates = services.online_players.combine(
            payload,
            max_games,
        )
        return {
            "dataset": dataset,
            "warnings": warnings,
            "duplicates": duplicates,
        }

    @router.get("/players/{source}/{external_id}")
    def player_detail(source: str, external_id: str):
        return services.online_players.detail(source, external_id)

    @router.post("/players/{source}/{external_id}/refresh-games")
    def refresh_games(
        source: str,
        external_id: str,
        max_games: int = Query(100, ge=1, le=100),
    ):
        return services.online_players.refresh(source, external_id, max_games)

    @router.get("/players/{source}/{external_id}/games")
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
        dataset = services.online_players.get_dataset(source, external_id)
        games = services.datasets.filter(
            dataset,
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
            "trace": services.datasets.trace(dataset, games, mode, pace),
        }

    @router.get("/players/{source}/{external_id}/stats")
    def player_stats(
        source: str,
        external_id: str,
        mode: Mode = Mode.COMBINED,
        pace: Pace = Pace.GLOBAL,
    ):
        dataset = services.online_players.get_dataset(source, external_id)
        return services.datasets.statistics(dataset, mode, pace)

    @router.get("/players/{source}/{external_id}/stats/by-color")
    def player_stats_by_color(
        source: str,
        external_id: str,
        mode: Mode = Mode.COMBINED,
        pace: Pace = Pace.GLOBAL,
    ):
        dataset = services.online_players.get_dataset(source, external_id)
        stats = services.datasets.statistics(dataset, mode, pace)
        return {
            key: stats[key]
            for key in (
                "mode",
                "pace",
                "sample_size",
                "sources",
                "date_range",
                "by_color",
            )
        }

    @router.get("/players/{source}/{external_id}/stats/openings")
    def player_stats_openings(
        source: str,
        external_id: str,
        mode: Mode = Mode.COMBINED,
        pace: Pace = Pace.GLOBAL,
        color: str | None = None,
    ):
        dataset = services.online_players.get_dataset(source, external_id)
        stats = services.datasets.statistics(dataset, mode, pace)
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

    @router.get("/games/{source}/{game_id}")
    def game_detail(source: str, game_id: str):
        # The synthetic dataset is lazy; real game lookups must not create it.
        if source == services.demo.player.source:
            services.demo.ensure()
        return services.datasets.game(source, game_id)

    return router
