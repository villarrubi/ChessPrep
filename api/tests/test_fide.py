from api.app.models import FidePlayer, GameType
from api.app.providers import fide
from api.app.services.pgn import parse_pgn


PROFILE_HTML = """
<h1 class="player-title">Carlsen, Magnus</h1>
<div class="profile-standart"><p>2837</p></div>
<div class="profile-rapid"><p>2818</p></div>
<div class="profile-blitz"><p>2881</p></div>
<p class="profile-info-id ">1503014</p>
<div class="profile-info-country"><img src="nor.png"> Norway </div>
<div class="profile-info-title"><p>Grandmaster</p></div>
"""


def test_official_fide_profile_is_parsed(monkeypatch):
    monkeypatch.setattr(fide, "_get_html", lambda _: PROFILE_HTML)
    monkeypatch.setattr(
        fide,
        "_get_rating_history",
        lambda _: [fide.FideRatingPoint(date="2026-Jul", rating=2837, rapid_rating=2818, blitz_rating=2881)],
    )
    player = fide.get_player("1503014")
    assert player.name == "Carlsen, Magnus"
    assert player.federation == "Norway"
    assert player.title == "GM"
    assert (player.standard_rating, player.rapid_rating, player.blitz_rating) == (2837, 2818, 2881)
    assert player.rating_history[0].rating == 2837
    assert player.rating_history[0].rapid_rating == 2818
    assert player.rating_history[0].blitz_rating == 2881


def test_fide_rating_history_is_validated_and_deduplicated():
    history = fide._parse_rating_history(
        [
            {"date_2": "2026-May", "rating": "2815", "rapid_rtng": "2801", "blitz_rtng": "2790"},
            {"date_2": "2026-Jun", "rating": "2826", "rapid_rtng": "2812", "blitz_rtng": "2805"},
            {"date_2": "2026-Jun", "rating": "2999"},
            {"date_2": "<script>", "rating": "3000"},
            {"date_2": "2026-Jul", "rating": "not-a-number", "rapid_rtng": "2819"},
            {"date_2": "2026-Aug", "rating": "99999"},
        ]
    )

    assert [(point.date, point.rating, point.rapid_rating, point.blitz_rating) for point in history] == [
        ("2026-May", 2815, 2801, 2790),
        ("2026-Jun", 2826, 2812, 2805),
        ("2026-Jul", None, 2819, None),
    ]


def test_fide_name_matching_accepts_order_and_initial_but_not_same_surname_only():
    assert fide.names_match("Carlsen, Magnus", "Magnus Carlsen")
    assert fide.names_match("Carlsen, Magnus", "Carlsen, M")
    assert not fide.names_match("Polgar, Judit", "Susan Polgar")
    assert not fide.names_match("Carlsen, Magnus", "Hikaru Nakamura")


def test_pgn_fide_id_has_priority_over_the_displayed_name():
    parsed = parse_pgn(
        """[Event "Test"]
[White "M. Carlsen"]
[WhiteFideId "1503014"]
[Black "Opponent"]
[BlackFideId "9999999"]
[Result "1-0"]
1. e4 e5 1-0
""",
        source="pgn_import",
        game_type=GameType.OTB,
        target_player="Carlsen, Magnus",
    )
    player = FidePlayer(
        fide_id="1503014",
        name="Carlsen, Magnus",
        profile_url="https://ratings.fide.com/profile/1503014",
    )
    assert parsed.games[0].white_fide_id == "1503014"
    assert fide.verified_color(parsed.games[0], player) == "white"
