from __future__ import annotations

from collections import Counter, defaultdict
from typing import Iterable

from api.app.models import Mode, NormalizedGame, Pace
from api.app.services.pgn import (
    OpeningMoveStep,
    opening_move_path,
    opening_move_sequence,
)


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
    pace: Pace = Pace.GLOBAL,
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
        if pace != Pace.GLOBAL and game.time_class != pace.value:
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


def _most_common_moves(moves: Counter[str]) -> list[dict[str, object]]:
    return [
        {"move": move, "games": games}
        for move, games in sorted(moves.items(), key=lambda item: (-item[1], item[0]))[:3]
    ]


def _opening_decision_map(games: list[NormalizedGame], color: str) -> dict[str, object]:
    color_games = [game for game in games if game.player_color == color]
    games_by_id = {game.id: game for game in color_games}
    full_paths = {
        game.id: opening_move_sequence(game.moves_uci) for game in color_games
    }
    supported_positions = {
        step.position_id
        for game in color_games
        for step in opening_move_path(game.moves_uci)
    }

    # A game may leave the ECO database immediately after playing a move that
    # another game shares on its way to a deeper named position. Walk backwards
    # from every supported position across all routes so that identical moves
    # from an identical position cannot be split between a visible branch and
    # the residual group.
    position_predecessors: dict[str, set[str]] = defaultdict(set)
    for steps in full_paths.values():
        for previous, current in zip(steps, steps[1:]):
            position_predecessors[current.position_id].add(previous.position_id)

    pending_positions = list(supported_positions)
    while pending_positions:
        position_id = pending_positions.pop()
        for predecessor_id in position_predecessors[position_id]:
            if predecessor_id in supported_positions:
                continue
            supported_positions.add(predecessor_id)
            pending_positions.append(predecessor_id)

    node_steps: dict[str, OpeningMoveStep] = {}
    node_game_ids: dict[str, set[str]] = defaultdict(set)
    node_moves: dict[str, Counter[str]] = defaultdict(Counter)
    node_parents: dict[str, set[str]] = defaultdict(set)
    edge_game_ids: dict[tuple[str, str], set[str]] = defaultdict(set)
    edge_moves: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    root_id = "__root__"

    for game in color_games:
        previous = root_id
        seen_positions: set[str] = set()
        deepest_supported = max(
            (
                index
                for index, step in enumerate(full_paths[game.id])
                if step.position_id in supported_positions
            ),
            default=-1,
        )
        for step in full_paths[game.id][: deepest_supported + 1]:
            if step.position_id in seen_positions:
                break
            seen_positions.add(step.position_id)
            move = game.moves[step.ply - 1] if step.ply <= len(game.moves) else ""
            node_steps.setdefault(step.position_id, step)
            node_game_ids[step.position_id].add(game.id)
            if move:
                node_moves[step.position_id][move] += 1

            edge = (previous, step.position_id)
            edge_game_ids[edge].add(game.id)
            if move:
                edge_moves[edge][move] += 1
            node_parents[step.position_id].add(previous)
            previous = step.position_id

    def edge_payload(source_id: str, target_id: str) -> dict[str, object]:
        ids = edge_game_ids[(source_id, target_id)]
        edge_games = [games_by_id[game_id] for game_id in ids]
        parent_total = (
            len(color_games) if source_id == root_id else len(node_game_ids[source_id])
        )
        return {
            "node_id": target_id,
            **_record(edge_games),
            "share_pct": round(len(ids) / parent_total * 100, 1) if parent_total else 0,
            "game_ids": sorted(ids),
            "moves": _most_common_moves(edge_moves[(source_id, target_id)]),
        }

    def remainder_payload(ids: set[str], parent_total: int) -> dict[str, object]:
        remainder_games = [games_by_id[game_id] for game_id in ids]
        return {
            **_record(remainder_games),
            "share_pct": round(len(ids) / parent_total * 100, 1) if parent_total else 0,
            "game_ids": sorted(ids),
        }

    children_by_source: dict[str, list[dict[str, object]]] = defaultdict(list)
    for source_id, target_id in edge_game_ids:
        children_by_source[source_id].append(edge_payload(source_id, target_id))

    def sort_edges(edges: list[dict[str, object]]) -> list[dict[str, object]]:
        return sorted(
            edges,
            key=lambda edge: (
                -int(edge["games"]),
                node_steps[str(edge["node_id"])].name or str(edge["node_id"]),
            ),
        )

    nodes: dict[str, dict[str, object]] = {}
    for position_id, step in node_steps.items():
        ids = node_game_ids[position_id]
        node_games = [games_by_id[game_id] for game_id in ids]
        children = sort_edges(children_by_source[position_id])
        continued_ids = {
            game_id
            for edge in children
            for game_id in edge["game_ids"]
        }
        mover_color = "white" if step.ply % 2 else "black"
        nodes[position_id] = {
            "id": position_id,
            "eco": step.eco,
            "opening": step.name,
            "actor": "player" if mover_color == color else "opponent",
            "ply": step.ply,
            **_record(node_games),
            "game_ids": sorted(ids),
            "moves": _most_common_moves(node_moves[position_id]),
            "transposition_routes": len(node_parents[position_id]),
            "children": children,
            "other_continuations": remainder_payload(ids - continued_ids, len(ids)),
        }

    classified_ids = set().union(*(node_game_ids.values())) if node_game_ids else set()
    unclassified_ids = set(games_by_id) - classified_ids
    return {
        "color": color,
        **_record(color_games),
        "game_ids": sorted(games_by_id),
        "classified_games": len(classified_ids),
        "unclassified_games": len(color_games) - len(classified_ids),
        "unclassified_branch": remainder_payload(unclassified_ids, len(color_games)),
        "roots": sort_edges(children_by_source[root_id]),
        "nodes": nodes,
    }


def calculate_stats(
    games: list[NormalizedGame],
    mode: Mode = Mode.COMBINED,
    pace: Pace = Pace.GLOBAL,
) -> dict:
    selected = filter_games(games, mode=mode, pace=pace)
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

    grouped: dict[tuple[str | None, str, str], list[NormalizedGame]] = defaultdict(list)
    for game in selected:
        grouped[(game.eco, game.opening, game.player_color)].append(game)
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
    openings.sort(
        key=lambda item: (-item["games"], -item["score_pct"], item["eco"] or "")
    )

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
        "pace": pace.value,
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
        "opening_decisions": {
            color: _opening_decision_map(selected, color) for color in ("white", "black")
        },
        "recent_form": form,
    }
