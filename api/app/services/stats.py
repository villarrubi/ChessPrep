from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from api.app.models import Mode, NormalizedGame


def outcome_for_player(game: NormalizedGame) -> str:
    if game.result == "1/2-1/2":
        return "draw"
    if game.result == "*":
        return "unknown"
    won = (game.player_color == "white" and game.result == "1-0") or (
        game.player_color == "black" and game.result == "0-1"
    )
    return "win" if won else "loss"


def filter_games(
    games: Iterable[NormalizedGame],
    *,
    mode: Mode = Mode.COMBINED,
    color: str | None = None,
    eco: str | None = None,
    result: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[NormalizedGame]:
    filtered: list[NormalizedGame] = []
    for game in games:
        if mode != Mode.COMBINED and game.game_type.value != mode.value:
            continue
        if color and color != "all" and game.player_color != color:
            continue
        if eco and game.eco != eco:
            continue
        if result and result != "all" and outcome_for_player(game) != result:
            continue
        if date_from and game.date and game.date < date_from:
            continue
        if date_to and game.date and game.date > date_to:
            continue
        filtered.append(game)
    return filtered


def _record(games: list[NormalizedGame]) -> dict:
    outcomes = [outcome_for_player(game) for game in games]
    wins = outcomes.count("win")
    draws = outcomes.count("draw")
    losses = outcomes.count("loss")
    decided = wins + draws + losses
    return {
        "games": len(games),
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "score_pct": round(((wins + draws * 0.5) / decided * 100), 1) if decided else 0,
        "win_pct": round(wins / decided * 100, 1) if decided else 0,
        "draw_pct": round(draws / decided * 100, 1) if decided else 0,
        "loss_pct": round(losses / decided * 100, 1) if decided else 0,
    }


def calculate_stats(games: list[NormalizedGame], mode: Mode = Mode.COMBINED) -> dict:
    selected = filter_games(games, mode=mode)
    dates = sorted(game.date for game in selected if game.date)
    sources = sorted({game.source for game in selected})
    overall = _record(selected)

    colors = []
    for color in ("white", "black"):
        color_games = [game for game in selected if game.player_color == color]
        ratings = [
            (game.black_elo if color == "white" else game.white_elo)
            for game in color_games
            if (game.black_elo if color == "white" else game.white_elo)
        ]
        colors.append(
            {
                "color": color,
                **_record(color_games),
                "average_opponent_elo": round(sum(ratings) / len(ratings)) if ratings else None,
            }
        )

    grouped: dict[tuple[str, str, str], list[NormalizedGame]] = defaultdict(list)
    for game in selected:
        grouped[(game.eco or "—", game.opening, game.player_color)].append(game)
    openings = [
        {
            "eco": key[0],
            "opening": key[1],
            "color": key[2],
            **_record(group_games),
            "share_pct": round(len(group_games) / len(selected) * 100, 1) if selected else 0,
        }
        for key, group_games in grouped.items()
    ]
    openings.sort(key=lambda item: (-item["games"], -item["score_pct"], item["eco"]))

    recent = sorted(selected, key=lambda game: game.date or "", reverse=True)[:8]
    form = [
        {
            "game_id": game.id,
            "date": game.date,
            "opponent": game.black if game.player_color == "white" else game.white,
            "outcome": outcome_for_player(game),
            "color": game.player_color,
        }
        for game in recent
    ]

    return {
        "mode": mode.value,
        "sample_size": len(selected),
        "sources": sources,
        "date_range": {"from": dates[0] if dates else None, "to": dates[-1] if dates else None},
        "mode_breakdown": {
            "online": sum(game.game_type.value == "online" for game in selected),
            "otb": sum(game.game_type.value == "otb" for game in selected),
        },
        "overall": overall,
        "by_color": colors,
        "openings": openings,
        "recent_form": form,
    }

