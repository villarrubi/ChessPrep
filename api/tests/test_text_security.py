from api.app.services.text import clean_identifier, clean_untrusted_text


def test_untrusted_text_removes_controls_and_is_bounded():
    assert clean_untrusted_text("  Evento\x00\x07 peligroso  ") == "Evento peligroso"
    assert clean_untrusted_text("x" * 20, max_length=8) == "xxxxxxxx"


def test_identifiers_cannot_inject_paths_or_markup():
    assert clean_identifier('../<script>alert("x")</script>') == "script-alert-x-script"
