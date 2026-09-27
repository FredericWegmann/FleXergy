"""Ganzer Ablauf am synthetischen Kühlhaus: Baseline, Rückblick, Fahrplan, Nachweis, Export."""
from datetime import date

import numpy as np

from src import baseline, db, export, fahrplan, nachweis


def test_backtest_und_genauigkeit(con, sid):
    g = nachweis.genauigkeit(con, sid, tage=60)
    assert g["tage"] >= 55
    assert g["mae_prozent_spitze"] < 5.0, "Kennzahl 1: MAE unter 5 Prozent der Spitzenlast"
    assert 60 <= g["band_abdeckung_prozent"] <= 95
    assert len(g["je_stunde"]) == 24 and len(g["histogramm"]) == 24


def test_baseline_reagiert_auf_temperatur_und_plan(con, sid):
    h = fahrplan.historie(con, sid)
    d = date(2026, 9, 28)
    kalt = baseline.prognose_tag(h, d, None, np.full(96, 5.0))
    warm = baseline.prognose_tag(h, d, None, np.full(96, 25.0))
    assert warm["zeilen"]["p50"].mean() > kalt["zeilen"]["p50"].mean() + 0.5
    assert warm["erklaerung"]["mw_je_grad"] > 0.03
    assert "No production plan" in " ".join(kalt["erklaerung"]["hinweise"])
    assert (kalt["zeilen"]["p10"] <= kalt["zeilen"]["p50"]).all() or kalt["erklaerung"]["band_quelle"] == "profile spread"


def test_fahrplan_folgetag(con, sid):
    fp = fahrplan.holen_oder_rechnen(con, sid, date(2026, 9, 28))
    assert len(fp["zeilen"]) == 96 and len(fp["bloecke"]) == 6
    assert fp["freigabe"]["status"] == "entwurf"
    z = fp["zeilen"]
    # P10 ist nie größer als P50, die Summe der Anlagen ist der Standortwert
    for r in z:
        assert r["pos"]["p10"] <= r["pos"]["p50"] + 1e-6
        assert abs(sum(a["pos"]["wert"] for a in r["anlagen"]) - r["pos"]["p50"]) < 1e-3
        assert r["pos"]["haltbar"]["240"] <= r["pos"]["haltbar"]["60"] + 1e-6 <= r["pos"]["haltbar"]["15"] + 2e-6
    # Montag 06:00 bis 09:00: kein Fenster, also vertragliche Grenze und 0 MW
    assert z[24]["pos"]["p50"] == 0 and z[24]["pos"]["begrenzung"] == "vertraglich"
    # Wareneingang über der Grenze begrenzt die Tiefkühlanlage, darunter nicht
    from src import einlesen
    plan = [{"von": f"{h:02d}:00", "schicht": "Late" if 13 <= h < 21 else "", "wareneingang_t": 60 if h == 14 else 0, "sperre": ""} for h in range(24)]
    db.plan_schreiben(con, sid, einlesen.plan_zeilen_ausrollen("2026-09-28", plan))
    fahrplan.cache_leeren(sid)
    fp = fahrplan.holen_oder_rechnen(con, sid, date(2026, 9, 28))
    z = fp["zeilen"]
    tk = lambda r: next(a for a in r["anlagen"] if a["name"].startswith("Freezer"))
    assert tk(z[56])["pos"]["grund"] == "prozessual" and tk(z[56])["pos"]["wert"] == 0
    assert tk(z[60])["pos"]["grund"] == "technisch" and tk(z[60])["pos"]["wert"] > 0.5
    # Nachts hält die Tiefkühlanlage vier Stunden: aFRR-fähig
    assert z[4]["pos"]["produkte"]["aFRR"]["p10"] > 0.3
    assert fp["zusammenfassung"]["pos_max_p10"] > 1.0
    assert fp["zusammenfassung"]["werthinweis_eur"] is not None


def test_gespeicherter_fahrplan_wird_wiederverwendet_und_neu_ersetzt(con, sid):
    d = date(2026, 9, 28)
    a = fahrplan.holen_oder_rechnen(con, sid, d)
    b = fahrplan.holen_oder_rechnen(con, sid, d)
    assert a["erstellt"] == b["erstellt"]
    db.fahrplan_status(con, sid, d.isoformat(), "freigegeben", "Werksleitung", "ok", "entscheiden")
    c = fahrplan.holen_oder_rechnen(con, sid, d)
    assert c["freigabe"]["status"] == "freigegeben"
    n = fahrplan.holen_oder_rechnen(con, sid, d, neu=True)
    assert n["freigabe"]["status"] == "entwurf", "Neu rechnen macht aus der Freigabe wieder einen Entwurf"


def test_nachholbedarf_blockiert_morgens(con, sid):
    d = date(2026, 9, 29)
    db.standort_aendern(con, sid, {"nachhol_mwh": 1.5})
    fahrplan.cache_leeren(sid)
    fp = fahrplan.rechnen(con, sid, d)
    assert fp["zeilen"][0]["pos"]["p50"] == 0
    assert any("Catch-up" in h for h in fp["zusammenfassung"]["hinweise"])
    db.standort_aendern(con, sid, {"nachhol_mwh": 0})
    fahrplan.cache_leeren(sid)


def test_abrufe_und_nachweis(con, sid):
    ab = nachweis.abrufe_bewerten(con, sid)
    assert ab["n"] >= 10
    assert ab["quote_prozent"] > 80
    n = nachweis.nachweis(con, sid, date(2026, 7, 1), date(2026, 9, 26))
    assert n["kennzahlen"]["mae_mw"] > 0 and len(n["je_tag"]) > 30
    csv = export.nachweis_csv(n)
    assert "Delivery rate" in csv and csv.count("\n") > 40


def test_exporte(con, sid):
    fp = fahrplan.holen_oder_rechnen(con, sid, date(2026, 9, 28))
    csv = export.fahrplan_csv(fp)
    assert csv.count("\n") == 97
    assert "Load reduction P10 MW" in csv
    import csv, io
    v = export.verfuegbarkeit_csv(fp)
    zeilen = list(csv.reader(io.StringIO(v)))
    assert len(zeilen) == 97
    assert zeilen[1][4].isdigit()
