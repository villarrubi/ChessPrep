from __future__ import annotations

import json
import queue
import threading
from collections.abc import Iterator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from api.app.errors import ApplicationError
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
        max_games: int = Query(50, ge=1, le=100),
        stream: bool = Query(False, description="Emit NDJSON progress events while combining"),
    ):
        if not stream:
            dataset, warnings, duplicates = services.online_players.combine(
                payload,
                max_games,
            )
            return {
                "dataset": services.datasets.dataset_summary(dataset),
                "warnings": warnings,
                "duplicates": duplicates,
            }

        def event_stream() -> Iterator[str]:
            events: queue.Queue[tuple[str, object]] = queue.Queue()

            def on_progress(event: dict) -> None:
                events.put(("progress", event))

            def worker() -> None:
                try:
                    dataset, warnings, duplicates = services.online_players.combine(
                        payload,
                        max_games,
                        on_progress=on_progress,
                    )
                    events.put(
                        (
                            "done",
                            {
                                "type": "done",
                                "dataset": services.datasets.dataset_summary(dataset),
                                "warnings": warnings,
                                "duplicates": duplicates,
                            },
                        )
                    )
                except ApplicationError as exc:
                    events.put(
                        (
                            "error",
                            {
                                "type": "error",
                                "detail": exc.detail,
                                "status_code": exc.status_code,
                            },
                        )
                    )
                except Exception as exc:  # pragma: no cover - defensive stream guard
                    events.put(
                        (
                            "error",
                            {
                                "type": "error",
                                "detail": str(exc) or "No se pudieron combinar los perfiles.",
                                "status_code": 500,
                            },
                        )
                    )

            threading.Thread(target=worker, daemon=True).start()
            while True:
                kind, payload_event = events.get()
                yield json.dumps(payload_event, ensure_ascii=False) + "\n"
                if kind in {"done", "error"}:
                    break

        return StreamingResponse(
            event_stream(),
            media_type="application/x-ndjson",
            headers={
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no",
            },
        )

    @router.get("/players/{source}/{external_id}")
    def player_detail(source: str, external_id: str):
        return services.online_players.detail(source, external_id)

    @router.post("/players/{source}/{external_id}/refresh-games")
    def refresh_games(
        source: str,
        external_id: str,
        max_games: int = Query(50, ge=1, le=100),
    ):
        result = services.online_players.refresh(source, external_id, max_games)
        return {
            **result,
            "dataset": services.datasets.dataset_summary(result["dataset"]),
        }

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
        page_size: int = Query(20, ge=1, le=500),
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
        page_items = games[start : start + page_size]
        return {
            "items": services.datasets.games_summary(page_items),
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
        opening_decisions = stats["opening_decisions"]
        if color:
            openings = [item for item in openings if item["color"] == color]
            opening_decisions = (
                {color: opening_decisions[color]} if color in opening_decisions else {}
            )
        return {
            "mode": stats["mode"],
            "pace": stats["pace"],
            "sample_size": stats["sample_size"],
            "sources": stats["sources"],
            "date_range": stats["date_range"],
            "openings": openings,
            "opening_decisions": opening_decisions,
        }

    @router.get("/games/{source}/{game_id}")
    def game_detail(source: str, game_id: str):
        # The synthetic dataset is lazy; real game lookups must not create it.
        if source == services.demo.player.source:
            services.demo.ensure()
        return services.datasets.game(source, game_id)

    return router
