from __future__ import annotations

import json
import queue
import threading
from collections.abc import Iterator
from datetime import date

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
        max_games: int = Query(
            100,
            ge=1,
            le=200,
            description="Maximum total number of games after merging sources",
        ),
        date_from: date | None = Query(None, alias="from"),
        date_to: date | None = Query(None, alias="to"),
        stream: bool = Query(False, description="Emit NDJSON progress events while combining"),
    ):
        def sample_request(dataset) -> dict[str, object]:
            by_source: dict[str, int] = {}
            for game in dataset.games:
                by_source[game.source] = by_source.get(game.source, 0) + 1
            return {
                "maximum": max_games,
                "loaded": len(dataset.games),
                "by_source": by_source,
                "from": date_from.isoformat() if date_from else None,
                "to": date_to.isoformat() if date_to else None,
            }

        if not stream:
            dataset, warnings, duplicates = services.online_players.combine(
                payload,
                max_games,
                date_from=date_from,
                date_to=date_to,
            )
            return {
                "dataset": services.datasets.dataset_summary(dataset),
                "warnings": warnings,
                "duplicates": duplicates,
                "sample_request": sample_request(dataset),
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
                        date_from=date_from,
                        date_to=date_to,
                    )
                    events.put(
                        (
                            "done",
                            {
                                "type": "done",
                                "dataset": services.datasets.dataset_summary(dataset),
                                "warnings": warnings,
                                "duplicates": duplicates,
                                "sample_request": sample_request(dataset),
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
        max_games: int = Query(100, ge=1, le=200),
        date_from: date | None = Query(None, alias="from"),
        date_to: date | None = Query(None, alias="to"),
    ):
        result = services.online_players.refresh(
            source,
            external_id,
            max_games,
            date_from,
            date_to,
        )
        dataset = result["dataset"]
        return {
            **result,
            "dataset": services.datasets.dataset_summary(dataset),
            "sample_request": {
                "maximum": max_games,
                "loaded": len(dataset.games),
                "by_source": {source: len(dataset.games)},
                "from": date_from.isoformat() if date_from else None,
                "to": date_to.isoformat() if date_to else None,
            },
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
