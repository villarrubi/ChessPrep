from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


MAX_PGN_CHARACTERS = 5_000_000


class GameType(str, Enum):
    ONLINE = "online"
    OTB = "otb"


class Mode(str, Enum):
    ONLINE = "online"
    OTB = "otb"
    COMBINED = "combined"


class Pace(str, Enum):
    GLOBAL = "global"
    BULLET = "bullet"
    BLITZ = "blitz"
    RAPID = "rapid"
    CLASSICAL = "classical"


class PlayerRef(BaseModel):
    source: str
    external_id: str
    username: str
    display_name: str
    title: str | None = None
    rating: int | None = None
    country: str | None = None
    avatar_url: str | None = None
    fide_id: str | None = None
    game_type: GameType = GameType.ONLINE


class NormalizedGame(BaseModel):
    id: str
    source: str
    source_game_id: str | None = None
    source_confidence: str
    game_type: GameType
    white: str
    black: str
    white_elo: int | None = None
    black_elo: int | None = None
    white_fide_id: str | None = None
    black_fide_id: str | None = None
    result: str
    date: str | None = None
    event: str | None = None
    site: str | None = None
    eco: str | None = None
    opening: str
    time_control: str | None = None
    time_class: str | None = None
    player_color: str
    target_player: str
    ply_count: int
    moves: list[str]
    moves_uci: list[str]
    fens: list[str]
    pgn: str
    dedupe_hash: str


class TemporaryDataset(BaseModel):
    dataset_id: str
    player: PlayerRef
    games: list[NormalizedGame]
    sources: list[str]
    created_at: datetime
    expires_at: datetime


class DatasetCreate(BaseModel):
    pgn: str = Field(min_length=8, max_length=MAX_PGN_CHARACTERS)
    game_type: GameType = GameType.OTB
    merge_with_dataset_id: str | None = Field(default=None, max_length=128)
    fide_id: str | None = Field(default=None, pattern=r"^\d{5,10}$")


class CombinedPlayerCreate(BaseModel):
    lichess_username: str | None = Field(default=None, min_length=2, max_length=80)
    chesscom_username: str | None = Field(default=None, min_length=2, max_length=80)


class FidePlayer(BaseModel):
    fide_id: str
    name: str
    federation: str | None = None
    title: str | None = None
    standard_rating: int | None = None
    rapid_rating: int | None = None
    blitz_rating: int | None = None
    profile_url: str


class Info64Result(BaseModel):
    id: str
    source: str = "info64"
    fide_id: str
    player_name: str
    opponent_name: str
    opponent_fide_id: str | None = None
    opponent_rating: int | None = None
    color: str | None = None
    outcome: str
    score: float
    result: str
    round: str | None = None
    board: str | None = None
    date: str | None = None
    time: str | None = None
    date_precision: str = "unknown"
    tournament: str
    tournament_start: str | None = None
    tournament_end: str | None = None
    tournament_url: str
    player_url: str
    walkover: bool = False


class Info64Summary(BaseModel):
    games: int
    wins: int
    draws: int
    losses: int
    score_percentage: float
    opponents: int
    tournaments: int
    walkovers: int
    date_range: dict[str, str | None]


class Info64ResultsResponse(BaseModel):
    player: FidePlayer
    results: list[Info64Result]
    summary: Info64Summary
    warnings: list[str]
    source_url: str
    tournaments_scanned: int
    tournaments_matched: int



class SearchResponse(BaseModel):
    results: list[PlayerRef]
    provider_available: bool
    message: str | None = None


class ApiError(BaseModel):
    code: str
    message: str
    detail: str | None = None
