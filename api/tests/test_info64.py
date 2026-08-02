from datetime import date

from api.app.models import FidePlayer
from api.app.providers import info64


SEARCH_HTML = """
<div id="search-results"><table>
  <tr><th>#</th><th>Name</th><th>Federation</th><th>Tournament</th><th>Start date</th><th>End date</th></tr>
  <tr>
    <td>1</td><td><a href="/open-2026/alice-smith">Smith, Alice</a></td><td>ESP</td>
    <td><a href="/open-2026">Open &amp; Masters 2026</a></td><td>2026-01-04</td><td>2026-01-07</td>
  </tr>
  <tr>
    <td>2</td><td><a href="/old-open/alice-smith">Smith, Alice</a></td><td>ESP</td>
    <td><a href="/old-open">Old Open</a></td><td>2020-01-04</td><td>2020-01-07</td>
  </tr>
</table></div>
"""

PLAYER_HTML = """
<h1>Open &amp; Masters 2026</h1><h2>Smith, Alice</h2>
<table><tr><th>FIDE Rating</th><td>2400 <a href="https://ratings.fide.com/profile/1000001">1000001</a></td></tr></table>
<table id="player-results">
  <tr><th>Rd.</th><th>Brd.</th><th>Col.</th><th>Ran.</th><th>Name</th><th>Fed.</th><th>FIDE</th><th>Nat.</th><th>Pts.</th><th>Res.</th><th>Var.</th></tr>
  <tr><td>1</td><td>4</td><td class="white">W</td><td>8</td><td><a href="/open-2026/bob">Bob &lt;Player&gt;</a><br><a href="https://ratings.fide.com/profile/2000002">2000002</a></td><td>ESP</td><td>2180</td><td></td><td>4</td><td>1</td><td></td></tr>
  <tr><td>2</td><td>2</td><td class="black">B</td><td>2</td><td><a href="/open-2026/carol">Carol Jones</a><br><a href="https://ratings.fide.com/profile/3000003">3000003</a></td><td>ENG</td><td>2320</td><td></td><td>5</td><td>-</td><td></td></tr>
  <tr><td>3</td><td>7</td><td class="white">W</td><td>34</td><td>Rival sin ficha FIDE</td><td>ESP</td><td>0</td><td></td><td>3</td><td>0.5</td><td></td></tr>
</table>
"""

SCHEDULE_HTML = """
<table>
  <tr><th><a href="/open-2026/1">Round 1</a></th><td><span class="mommentdate short">2026-01-04</span> 16:00</td></tr>
  <tr><th><a href="/open-2026/2">Round 2</a></th><td><span class="mommentdate short">2026-01-05</span> 10:30</td></tr>
  <tr><th><a href="/open-2026/3">Round 3</a></th><td><span class="mommentdate short">2026-01-06</span> 17:00</td></tr>
</table>
"""

TEAM_PLAYER_HTML = """
<table><tr><th>FIDE Rating</th><td>1551 <a href="https://ratings.fide.com/profile/1000001">1000001</a></td></tr></table>
<table id="player-results">
  <tr><td>1</td><td>4</td><td class="white">W</td><td><a href="/team/ctl/team-a/federated-player">Federated Player</a><a href="/team/ctl/team-a">Team A</a><a href="https://ratings.fide.com/profile/2222222">2222222</a></td><td class="playerfederation">ESP</td><td>1740</td><td>3</td><td>1</td><td>4.2</td></tr>
  <tr><td>2</td><td>4</td><td class="black">B</td><td><a href="/team/ctl/team-b/local-player">Local Player</a><a href="/team/ctl/team-b">Team B</a></td><td class="playerfederation">ESP</td><td>1625</td><td>2</td><td>0.5</td><td>-1.3</td></tr>
</table>
"""


def player() -> FidePlayer:
    return FidePlayer(
        fide_id="1000001",
        name="Smith, Alice",
        federation="ESP",
        title="GM",
        standard_rating=2400,
        profile_url="https://ratings.fide.com/profile/1000001",
    )


def fake_html(path: str) -> str:
    if path.startswith("/search-player?"):
        return SEARCH_HTML
    if path == "/open-2026/alice-smith?hl=en":
        return PLAYER_HTML
    if path == "/open-2026/schedule?hl=en":
        return SCHEDULE_HTML
    raise AssertionError(f"Ruta inesperada: {path}")


def test_info64_results_are_validated_by_fide_id_and_include_round_dates(monkeypatch):
    monkeypatch.setattr(info64, "_get_html", fake_html)

    payload = info64.fetch_results(
        player(),
        date_from=date(2025, 1, 1),
        date_to=date(2026, 12, 31),
    )

    assert payload["tournaments_scanned"] == 1
    assert payload["tournaments_matched"] == 1
    assert len(payload["results"]) == 3
    win = next(result for result in payload["results"] if result.outcome == "win")
    assert win.opponent_name == "Bob <Player>"
    assert win.opponent_fide_id == "2000002"
    assert win.opponent_rating == 2180
    assert win.color == "white"
    assert win.date == "2026-01-04"
    assert win.time == "16:00"
    assert win.date_precision == "round"
    loss = next(result for result in payload["results"] if result.outcome == "loss")
    assert loss.walkover is True
    non_federated = next(result for result in payload["results"] if result.opponent_fide_id is None)
    assert non_federated.opponent_name == "Rival sin ficha FIDE"
    assert non_federated.outcome == "draw"


def test_info64_date_filter_applies_to_the_exact_round(monkeypatch):
    monkeypatch.setattr(info64, "_get_html", fake_html)

    payload = info64.fetch_results(
        player(),
        date_from=date(2026, 1, 5),
        date_to=date(2026, 1, 5),
    )

    assert len(payload["results"]) == 1
    assert payload["results"][0].round == "2"


def test_info64_accepts_tournament_tables_without_a_header_row(monkeypatch):
    header = "  <tr><th>Rd.</th><th>Brd.</th><th>Col.</th><th>Ran.</th><th>Name</th><th>Fed.</th><th>FIDE</th><th>Nat.</th><th>Pts.</th><th>Res.</th><th>Var.</th></tr>\n"
    page_without_header = PLAYER_HTML.replace(header, "").replace(
        "</td><td></td><td>4</td><td>1</td>",
        "</td><td>4</td><td>1</td>",
        1,
    )
    monkeypatch.setattr(
        info64,
        "_get_html",
        lambda path: (
            SEARCH_HTML
            if path.startswith("/search-player?")
            else SCHEDULE_HTML
            if path.endswith("/schedule?hl=en")
            else page_without_header
        ),
    )

    payload = info64.fetch_results(player(), date_from=date(2025, 1, 1))

    assert any(result.opponent_name == "Bob <Player>" and result.outcome == "win" for result in payload["results"])


def test_info64_team_table_reads_opponent_and_rating_from_its_real_columns():
    candidate = info64._Candidate(
        player_path="/team/ctl/team-player",
        tournament_path="/team/ctl",
        player_name="Smith, Alice",
        tournament_name="CTL Teams",
        start_date="2026-06-20",
        end_date="2026-06-21",
    )

    results, ignored = info64._parse_results(
        TEAM_PLAYER_HTML,
        candidate,
        player(),
        {"1": ("2026-06-20", "10:00"), "2": ("2026-06-20", "12:00")},
        None,
        None,
    )

    assert ignored == 0
    assert [(result.opponent_name, result.opponent_rating) for result in results] == [
        ("Federated Player", 1740),
        ("Local Player", 1625),
    ]
    assert results[0].opponent_fide_id == "2222222"
    assert results[1].opponent_fide_id is None


def test_info64_rejects_homonyms_with_another_fide_id(monkeypatch):
    monkeypatch.setattr(
        info64,
        "_get_html",
        lambda path: (
            SEARCH_HTML
            if path.startswith("/search-player?")
            else PLAYER_HTML.replace("profile/1000001", "profile/9999999")
        ),
    )

    payload = info64.fetch_results(player(), date_from=date(2025, 1, 1))

    assert payload["results"] == []
    assert payload["tournaments_matched"] == 0
    assert "mismo nombre" in payload["warnings"][-1]


def test_info64_only_accepts_relative_paths_on_its_domain():
    assert info64._safe_relative_path("/event/player?hl=en") == "/event/player?hl=en"
    assert info64._safe_relative_path("https://attacker.example/event") is None
    assert info64._safe_relative_path("//attacker.example/event") is None
    assert info64._safe_relative_path("/event/../admin") is None
    assert info64._allowed_info64_url("https://info64.org/event") is True
    assert info64._allowed_info64_url("https://info64.org.attacker.example/event") is False
