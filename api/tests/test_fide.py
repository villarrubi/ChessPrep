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
    player = fide.get_player("1503014")
    assert player.name == "Carlsen, Magnus"
    assert player.federation == "Norway"
    assert player.title == "GM"
    assert (player.standard_rating, player.rapid_rating, player.blitz_rating) == (2837, 2818, 2881)


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
