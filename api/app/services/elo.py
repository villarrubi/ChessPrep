from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from api.app.models import EloDiscipline


# Official FIDE table 8.1.2: expected score for the higher-rated player.
EXPECTED_SCORE_TABLE = (
    (3, Decimal("0.50")),
    (10, Decimal("0.51")),
    (17, Decimal("0.52")),
    (25, Decimal("0.53")),
    (32, Decimal("0.54")),
    (39, Decimal("0.55")),
    (46, Decimal("0.56")),
    (53, Decimal("0.57")),
    (61, Decimal("0.58")),
    (68, Decimal("0.59")),
    (76, Decimal("0.60")),
    (83, Decimal("0.61")),
    (91, Decimal("0.62")),
    (98, Decimal("0.63")),
    (106, Decimal("0.64")),
    (113, Decimal("0.65")),
    (121, Decimal("0.66")),
    (129, Decimal("0.67")),
    (137, Decimal("0.68")),
    (145, Decimal("0.69")),
    (153, Decimal("0.70")),
    (162, Decimal("0.71")),
    (170, Decimal("0.72")),
    (179, Decimal("0.73")),
    (188, Decimal("0.74")),
    (197, Decimal("0.75")),
    (206, Decimal("0.76")),
    (215, Decimal("0.77")),
    (225, Decimal("0.78")),
    (235, Decimal("0.79")),
    (245, Decimal("0.80")),
    (256, Decimal("0.81")),
    (267, Decimal("0.82")),
    (278, Decimal("0.83")),
    (290, Decimal("0.84")),
    (302, Decimal("0.85")),
    (315, Decimal("0.86")),
    (328, Decimal("0.87")),
    (344, Decimal("0.88")),
    (357, Decimal("0.89")),
    (374, Decimal("0.90")),
    (391, Decimal("0.91")),
    (411, Decimal("0.92")),
    (432, Decimal("0.93")),
    (456, Decimal("0.94")),
    (484, Decimal("0.95")),
    (517, Decimal("0.96")),
    (559, Decimal("0.97")),
    (619, Decimal("0.98")),
    (735, Decimal("0.99")),
    (10_000, Decimal("1.00")),
)


# Official FIDE table 8.1.1 indexed by the score percentage from 0 to 100.
DP_BY_PERCENT = (
    -800, -677, -589, -538, -501, -470, -444, -422, -401, -383,
    -366, -351, -336, -322, -309, -296, -284, -273, -262, -251,
    -240, -230, -220, -211, -202, -193, -184, -175, -166, -158,
    -149, -141, -133, -125, -117, -110, -102, -95, -87, -80,
    -72, -65, -57, -50, -43, -36, -29, -21, -14, -7,
    0, 7, 14, 21, 29, 36, 43, 50, 57, 65,
    72, 80, 87, 95, 102, 110, 117, 125, 133, 141,
    149, 158, 166, 175, 184, 193, 202, 211, 220, 230,
    240, 251, 262, 273, 284, 296, 309, 322, 336, 351,
    366, 383, 401, 422, 444, 470, 501, 538, 589, 677, 800,
)


def _as_number(value: Decimal, places: str = "0.01") -> float:
    return float(value.quantize(Decimal(places), rounding=ROUND_HALF_UP))


def _table_probability(difference: int, *, higher: bool) -> Decimal:
    high_probability = next(
        probability
        for maximum, probability in EXPECTED_SCORE_TABLE
        if difference <= maximum
    )
    return high_probability if higher else Decimal("1") - high_probability


def expected_score(
    player_rating: int,
    opponent_rating: int,
    discipline: EloDiscipline,
) -> Decimal | None:
    difference = abs(player_rating - opponent_rating)
    if (
        discipline in {EloDiscipline.RAPID, EloDiscipline.BLITZ}
        and difference >= 600
        and max(player_rating, opponent_rating) > 2600
    ):
        return None
    if discipline in {EloDiscipline.RAPID, EloDiscipline.BLITZ}:
        effective_difference = min(difference, 400)
    elif player_rating < 2650:
        effective_difference = min(difference, 400)
    else:
        effective_difference = difference
    return _table_probability(
        effective_difference,
        higher=player_rating >= opponent_rating,
    )


def calculate_head_to_head(
    rating_a: int,
    k_a: int,
    rating_b: int,
    k_b: int,
    discipline: EloDiscipline,
) -> dict[str, object]:
    expected_a = expected_score(rating_a, rating_b, discipline)
    expected_b = expected_score(rating_b, rating_a, discipline)
    if expected_a is None or expected_b is None:
        return {
            "rated": False,
            "reason": "rapid_blitz_600_rule",
            "expected_a": None,
            "expected_b": None,
            "outcomes": [
                {"result": result, "change_a": 0.0, "change_b": 0.0}
                for result in ("a_win", "draw", "b_win")
            ],
        }

    outcomes = []
    for result, score_a in (
        ("a_win", Decimal("1")),
        ("draw", Decimal("0.5")),
        ("b_win", Decimal("0")),
    ):
        score_b = Decimal("1") - score_a
        outcomes.append(
            {
                "result": result,
                "change_a": _as_number(Decimal(k_a) * (score_a - expected_a)),
                "change_b": _as_number(Decimal(k_b) * (score_b - expected_b)),
            }
        )
    return {
        "rated": True,
        "reason": None,
        "expected_a": _as_number(expected_a),
        "expected_b": _as_number(expected_b),
        "outcomes": outcomes,
    }


def calculate_initial_rating(games: list[dict[str, object]]) -> dict[str, object]:
    game_count = len(games)
    real_score = sum(
        Decimal(str(game["score"]))
        for game in games
    )
    adjusted_games = game_count + 2
    adjusted_score = real_score + Decimal("1")
    average_rating = (
        sum(Decimal(int(game["rating"])) for game in games) + Decimal("3600")
    ) / Decimal(adjusted_games)
    fractional_score = adjusted_score / Decimal(adjusted_games)
    percentage = int(
        (fractional_score * Decimal("100")).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )
    dp = DP_BY_PERCENT[max(0, min(100, percentage))]
    uncapped_rating = average_rating + Decimal(dp)
    initial_rating = int(
        min(uncapped_rating, Decimal("2200")).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )

    periods = sorted(str(game["period"]) for game in games)
    first_year, first_month = map(int, periods[0].split("-"))
    last_year, last_month = map(int, periods[-1].split("-"))
    period_span = (last_year - first_year) * 12 + last_month - first_month + 1
    within_26_months = period_span <= 26
    publishable = (
        game_count >= 5
        and real_score > 0
        and initial_rating >= 1400
        and within_26_months
    )
    return {
        "game_count": game_count,
        "real_score": _as_number(real_score, "0.1"),
        "virtual_opponents": 2,
        "adjusted_game_count": adjusted_games,
        "adjusted_score": _as_number(adjusted_score, "0.1"),
        "average_rating": _as_number(average_rating),
        "fractional_score": _as_number(fractional_score),
        "score_percentage": _as_number(fractional_score * Decimal("100"), "0.1"),
        "dp": dp,
        "uncapped_rating": _as_number(uncapped_rating),
        "initial_rating": initial_rating,
        "capped_at_2200": uncapped_rating > 2200,
        "period_span_months": period_span,
        "within_26_months": within_26_months,
        "publishable": publishable,
    }
