"""Auf einen Blick: Spitzenkappung, Verschiebung und Regelleistung halten ihre Regeln ein."""
from datetime import date

import numpy as np

from src import blick, db


def test_blick_regeln(con, sid):
    b = blick.blick(con, sid, date(2026, 6, 18))
    k = b["kennzahlen"]
    assert len(b["zeiten"]) == 96 and len(b["nachher"]) == 96
    vorher, nachher = np.array(b["vorher"]), np.array(b["nachher"])
    pos_g, neg_g = np.array(b["pos_genutzt"]), np.array(b["neg_genutzt"])
    # Nachher bleibt unter der Zielspitze, die Spitze sinkt oder bleibt
    assert nachher.max() <= b["kappe"] + 1e-6
    assert k["spitze_nachher"] <= k["spitze_vorher"] + 1e-6
    # Energie bleibt erhalten: was reduziert wird, wird nachgeholt
    assert abs(pos_g.sum() - neg_g.sum()) * 0.25 < 0.01
    # Genutzt wird nie mehr als sicher verfügbar
    assert (pos_g <= np.array(b["pos_p10"]) + 1e-6).all()
    assert (neg_g <= np.array(b["neg_p10"]) + 1e-6).all()
    # Kein Reduktionsblock neben einem anderen Reduktionsblock (Erholzeit)
    arten = [bl["nutzung"] for bl in b["bloecke"]]
    for i in range(5):
        assert not (arten[i] == "reduktion" and arten[i + 1] == "reduktion")
    # Puffergrenze je Verschiebung
    for v in b["verschiebungen"]:
        assert v["energie_mwh"] <= b["annahmen"]["puffer_reduktion_mwh"] + 1e-6
        assert v["netto_eur"] > 0
    assert k["tag_eur"] == k["da_netto_eur"] + k["afrr_eur"]
    assert k["afrr_eur"] == k["afrr_pos_eur"] + k["afrr_neg_eur"]
    assert 0 <= k["anteil_verschoben_prozent"] < 30
    assert b["hat_ist"] and b["hat_preis"]
    # Regelleistung je Viertelstunde: nie mehr als aFRR-fähig und nie mehr als nach Nutzung übrig
    rp, rn = np.array(b["afrr_pos_vorgehalten"]), np.array(b["afrr_neg_vorgehalten"])
    assert (rp <= np.array(b["afrr_pos_faehig"]) + 1e-6).all() and (rn <= np.array(b["afrr_neg_faehig"]) + 1e-6).all()
    assert (rp + pos_g <= np.array(b["pos_p10"]) + 1e-6).all()
    assert (rn + neg_g <= np.array(b["neg_p10"]) + 1e-6).all()
    # Ein negativer Abruf bleibt unter der Zielspitze
    assert (nachher + rn <= b["kappe"] + 1e-6).all()
    assert k["afrr_eur"] > 100, "Regelleistung ist das Hauptziel und muss am Beispieltag Erlös bringen"
    assert abs(sum(b["erloes_afrr"]) - k["afrr_eur"]) < 2


def test_blick_ohne_preise_und_prognosetag(con, sid):
    b = blick.blick(con, sid, date(2026, 9, 29))
    assert not b["hat_ist"]
    assert any("No measured load" in h for h in b["hinweise"])
    # Spitzenkappung geht auch ohne Preise, Verschiebung nicht
    con.execute("DELETE FROM preise WHERE zeit >= '2026-09-29T00:00' AND zeit < '2026-09-30T00:00'")
    con.commit()
    blick._cache.clear()
    b = blick.blick(con, sid, date(2026, 9, 29))
    assert not b["hat_preis"] and b["verschiebungen"] == [] and b["kennzahlen"]["da_netto_eur"] == 0


def test_annahmen_wirken(con, sid):
    b1 = blick.blick(con, sid, date(2026, 6, 18))
    db.standort_aendern(con, sid, {"leistungspreis_eur_kw_a": 60})
    blick._cache.clear()
    b2 = blick.blick(con, sid, date(2026, 6, 18))
    assert abs(b2["kennzahlen"]["spitze_wert_jahr_eur"] * 2 - b1["kennzahlen"]["spitze_wert_jahr_eur"]) < 2
    db.standort_aendern(con, sid, {"leistungspreis_eur_kw_a": 120})
    blick._cache.clear()


def test_jahr_zusammenfassung(con, sid):
    from src import jahr
    tage = jahr._tage(con, sid)
    assert len(tage) >= 300
    j = jahr.rechnen(con, sid, tage[-6:])
    assert j["tage"] == 6 and len(j["monate"]) >= 1
    s = j["summen"]
    assert s["gesamt_eur"] == s["afrr_eur"] + s["da_eur"] + s["spitze_eur"]
    assert s["spitze_nachher_mw"] <= s["spitze_vorher_mw"]
    assert j["jahr"]["afrr_eur"] > s["afrr_eur"], "Hochrechnung auf 365 Tage"
    stand = jahr.stand(con, sid)
    assert stand["status"] in ("laeuft", "fertig")


def test_kapazitaetspreise_datei(con, sid):
    from src import kapazitaet
    text = "Date;Time block;FCR (EUR/MW/h);aFRR POS (EUR/MW/h);aFRR NEG (EUR/MW/h);mFRR POS (EUR/MW/h);mFRR NEG (EUR/MW/h)\n"
    for blk, p in (("00:00 to 04:00", "4,39"), ("04:00 to 08:00", "10,7"), ("08:00 to 12:00", "42,46"), ("12:00 to 16:00", "26,82"), ("16:00 to 20:00", "39,69"), ("20:00 to 24:00", "15,03")):
        text += f"2026-06-18;{blk};7,25;{p};8,65;0,82;4,86\n"
    df = kapazitaet.einlesen(text)
    assert len(df) == 96 and df["afrr_pos"].iloc[40] == 42.46
    kapazitaet.schreiben(con, df, quelle="test file")
    blick._cache.clear()
    b = blick.blick(con, sid, date(2026, 6, 18))
    assert b["annahmen"]["afrr_preisquelle"] == "test file"
    assert abs(b["annahmen"]["afrr_eur_mw_h"] - (4.39 + 10.7 + 42.46 + 26.82 + 39.69 + 15.03) / 6) < 0.01
