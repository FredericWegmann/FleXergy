"""Regeln der flexiblen Leistung je Anlage: jede der vier Grenzen greift nachweisbar."""
from src.flex import block_dauer, flex_anlage, in_laufzeit, p_ist_anlage

ANLAGE = {"id": 1, "name": "Chiller", "typ": "kaelte", "p_nenn_mw": 2.0, "p_min_mw": 0.5, "rampe_mw_min": 0.2,
          "max_dauer_min": 120, "erholzeit_min": 60, "puffer_mwh": 3.0, "anteil_prozent": 50, "plan_grenze_t_h": 40, "laufzeiten": []}
FENSTER = [{"wochentag": 0, "von": "00:00", "bis": "24:00", "p_pos_max_mw": None, "p_neg_max_mw": 0.8}]
PLAN = {"wareneingang_t": 0.0, "sperre": ""}


def test_technische_grenze_mindestlast():
    r = flex_anlage(ANLAGE, 1.5, 600, 0, PLAN, FENSTER, 50, 0, "pos")
    assert r["technisch"] == 1.0
    assert r["wert"] == 1.0
    assert r["grund"] == "technisch"
    assert r["t_voll_min"] == 5.0
    assert "Intraday 15 min" in r["produkte"]


def test_produkte_afrr_viertelstunde_mfrr_vier_stunden():
    # aFRR wird je Viertelstunde beschafft: 15 Minuten haltbar und volle Leistung nach 5 Minuten reichen
    r = flex_anlage(ANLAGE, 1.5, 600, 0, PLAN, FENSTER, 50, 0, "pos")
    assert r["dauer_min"] == 60
    assert "aFRR" in r["produkte"] and "mFRR" not in r["produkte"]
    # Langsame Rampe: kein aFRR, aber Intraday
    langsam = dict(ANLAGE, rampe_mw_min=0.1)
    r = flex_anlage(langsam, 1.5, 600, 0, PLAN, FENSTER, 50, 0, "pos")
    assert r["t_voll_min"] == 10.0 and "aFRR" not in r["produkte"] and "Intraday 15 min" in r["produkte"]
    # mFRR braucht vier Stunden: großer Puffer und lange Abrufdauer
    gross = dict(ANLAGE, puffer_mwh=12.0, max_dauer_min=480)
    r = flex_anlage(gross, 1.5, 600, 0, PLAN, FENSTER, 50, 0, "pos")
    assert r["dauer_min"] == 240
    assert r["produkte"] == ["aFRR", "mFRR", "Intraday 15 min"]


def test_prozessuale_grenze_wareneingang():
    r = flex_anlage(ANLAGE, 1.5, 600, 0, {"wareneingang_t": 55, "sperre": ""}, FENSTER, 50, 0, "pos")
    assert r["wert"] == 0
    assert r["grund"] == "prozessual"
    assert any("Goods intake" in g for g in r["gruende"])
    # Lasterhöhung bleibt erlaubt
    r = flex_anlage(ANLAGE, 1.5, 600, 0, {"wareneingang_t": 55, "sperre": ""}, FENSTER, 50, 0, "neg")
    assert r["wert"] > 0


def test_sperre_im_plan_trifft_anlage():
    r = flex_anlage(ANLAGE, 1.5, 600, 0, {"wareneingang_t": 0, "sperre": "chiller"}, FENSTER, 50, 0, "pos")
    assert r["wert"] == 0 and r["grund"] == "prozessual"
    r = flex_anlage(ANLAGE, 1.5, 600, 0, {"wareneingang_t": 0, "sperre": "all"}, FENSTER, 50, 0, "neg")
    assert r["wert"] == 0


def test_energetische_grenze_puffer_und_nachholbedarf():
    klein = dict(ANLAGE, puffer_mwh=0.2)
    r = flex_anlage(klein, 1.5, 600, 0, PLAN, FENSTER, 50, 0, "pos")
    assert r["energetisch"] == 0.4  # 0,1 MWh in einer Viertelstunde
    assert r["wert"] == 0.4 and r["grund"] == "energetisch"
    r = flex_anlage(ANLAGE, 1.5, 600, 0, PLAN, FENSTER, 50, 0.7, "pos")
    assert r["wert"] == 0 and r["grund"] == "energetisch"
    assert any("Catch-up" in g for g in r["gruende"])


def test_vertragliche_grenze_fenster():
    r = flex_anlage(ANLAGE, 1.5, 600, 2, PLAN, FENSTER, 50, 0, "pos")  # Mittwoch ohne Fenster
    assert r["wert"] == 0 and r["grund"] == "vertraglich"
    r = flex_anlage(ANLAGE, 1.0, 600, 0, PLAN, FENSTER, 50, 0, "neg")  # Erhöhung auf 0,8 begrenzt
    assert r["technisch"] == 1.0 and r["vertraglich"] == 0.8
    assert r["wert"] == 0.8 and r["grund"] == "vertraglich"
    # Rest des Fensters begrenzt die Dauer
    kurz = [{"wochentag": 0, "von": "00:00", "bis": "10:30", "p_pos_max_mw": None, "p_neg_max_mw": None}]
    r = flex_anlage(ANLAGE, 1.5, 600, 0, PLAN, kurz, 50, 0, "pos")
    assert r["dauer_min"] == 30


def test_schaltbarer_block():
    ab = {"id": 2, "name": "Defrost", "typ": "schaltbar", "p_nenn_mw": 0.5, "p_min_mw": 0, "rampe_mw_min": 0.5,
          "max_dauer_min": 240, "erholzeit_min": 0, "puffer_mwh": 0, "anteil_prozent": 0, "plan_grenze_t_h": None,
          "laufzeiten": ["02:00-02:45", "14:00-14:45"]}
    assert in_laufzeit(ab["laufzeiten"], 130) and not in_laufzeit(ab["laufzeiten"], 200)
    assert p_ist_anlage(ab, 3.0, 130) == 0.5 and p_ist_anlage(ab, 3.0, 600) == 0.0
    assert block_dauer(ab["laufzeiten"], 120, "pos") == 45 and block_dauer(ab["laufzeiten"], 135, "pos") == 30
    assert block_dauer(ab["laufzeiten"], 600, "neg") == 45
    r = flex_anlage(ab, 0.5, 120, 0, PLAN, FENSTER, 50, 0, "pos")
    assert r["wert"] == 0.5 and r["dauer_min"] == 45 and r["produkte"] == ["aFRR", "Intraday 15 min"]
    r = flex_anlage(ab, 0.0, 600, 0, PLAN, FENSTER, 50, 0, "neg")
    assert r["wert"] == 0.5 and r["dauer_min"] == 45


def test_anteil_bestimmt_erwartete_last():
    assert p_ist_anlage(ANLAGE, 3.0, 0) == 1.5
    assert p_ist_anlage(ANLAGE, 6.0, 0) == 2.0  # höchstens Nennleistung
