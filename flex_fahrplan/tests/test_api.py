"""HTTP-Schnittstelle mit dem Testclient. Läuft gegen eine eigene Datenbank."""
import io
from datetime import date

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os
    os.environ["FLEX_DB"] = str(tmp_path_factory.mktemp("api") / "api.db")
    from src import api
    import importlib
    importlib.reload(api)
    return TestClient(api.app)


def test_beispiel_und_fahrplan(client):
    r = client.post("/api/standorte/beispiel?stichtag=2026-09-27&skalierung=1")
    assert r.status_code == 200
    sid = r.json()["id"]
    r = client.get(f"/api/standorte/{sid}/fahrplan?datum=2026-09-28")
    assert r.status_code == 200
    fp = r.json()
    assert len(fp["zeilen"]) == 96 and fp["freigabe"]["status"] == "entwurf"
    # Verfügbarkeitsmeldung erst nach Freigabe
    assert client.get(f"/api/standorte/{sid}/fahrplan/2026-09-28/verfuegbarkeit.csv").status_code == 409
    assert client.post(f"/api/standorte/{sid}/fahrplan/2026-09-28/freigabe", json={"aktion": "freigeben", "name": "x"}).status_code == 409
    r = client.post(f"/api/standorte/{sid}/fahrplan/2026-09-28/freigabe", json={"aktion": "anfordern", "name": "Energiemanager"})
    assert r.json()["freigabe"]["status"] == "angefordert"
    r = client.post(f"/api/standorte/{sid}/fahrplan/2026-09-28/freigabe", json={"aktion": "freigeben", "name": "Werksleitung", "kommentar": "Für Montag in Ordnung"})
    assert r.json()["freigabe"]["status"] == "freigegeben"
    r = client.get(f"/api/standorte/{sid}/fahrplan/2026-09-28/verfuegbarkeit.csv")
    assert r.status_code == 200 and "approved" in r.text
    assert client.get(f"/api/standorte/{sid}/fahrplan/2026-09-28/export.csv").text.count("\n") == 97
    assert client.get(f"/api/standorte/{sid}/fahrplan/2026-09-28/export.json").status_code == 200


def test_plan_aendern_rechnet_neu(client):
    sid = client.get("/api/standorte").json()[0]["id"]
    plan = client.get(f"/api/standorte/{sid}/plan?datum=2026-09-28").json()
    assert plan["vorhanden"] and len(plan["stunden"]) == 24
    stunden = plan["stunden"]
    for s in stunden:
        s["wareneingang_t"] = 0
        s["sperre"] = "all" if s["von"] == "10:00" else ""
    r = client.put(f"/api/standorte/{sid}/plan?datum=2026-09-28", json=stunden)
    assert r.status_code == 200
    fp = client.get(f"/api/standorte/{sid}/fahrplan?datum=2026-09-28&neu=1").json()
    assert fp["freigabe"]["status"] == "entwurf"
    assert fp["zeilen"][40]["pos"]["p50"] == 0 and fp["zeilen"][40]["pos"]["begrenzung"] == "prozessual"
    assert fp["zeilen"][56]["pos"]["p50"] > 0, "without goods intake the freezer plant is free in the afternoon"


def test_anlagen_und_fenster(client):
    sid = client.get("/api/standorte").json()[0]["id"]
    r = client.post(f"/api/standorte/{sid}/anlagen", json={"name": "Pump", "typ": "pumpe", "p_nenn_mw": 0.3, "p_min_mw": 0.5})
    assert r.status_code == 400
    r = client.post(f"/api/standorte/{sid}/anlagen", json={"name": "Pump", "typ": "pumpe", "p_nenn_mw": 0.3, "anteil_prozent": 5, "puffer_mwh": 0.2})
    assert r.status_code == 200
    aid = r.json()["id"]
    r = client.put(f"/api/anlagen/{aid}", json={"name": "Pump 2", "typ": "pumpe", "p_nenn_mw": 0.4, "anteil_prozent": 5, "aktiv": False})
    assert r.json()["name"] == "Pump 2" and r.json()["aktiv"] == 0
    assert client.delete(f"/api/anlagen/{aid}").json()["ok"]
    r = client.put(f"/api/standorte/{sid}/fenster", json=[{"wochentag": 0, "von": "10:00", "bis": "09:00"}])
    assert r.status_code == 400
    alt = client.get(f"/api/standorte/{sid}/fenster").json()
    r = client.put(f"/api/standorte/{sid}/fenster", json=alt)
    assert r.status_code == 200 and len(r.json()) == len(alt)


def test_neuer_standort_mit_csv_upload(client):
    r = client.post("/api/standorte", json={"name": "Test plant", "spitzenlast_mw": 2})
    sid = r.json()["id"]
    assert client.get(f"/api/standorte/{sid}/fahrplan?datum=2026-09-28").status_code == 409
    zeilen = ["Date;Time;Power kW;Temperature"]
    import datetime as dt
    t = dt.datetime(2026, 7, 1)
    for k in range(96 * 21):
        z = t + dt.timedelta(minutes=15 * k)
        zeilen.append(f"{z:%d.%m.%Y};{z:%H:%M};{1200 + 300 * (6 <= z.hour < 20)},5;{12 + z.hour / 4}")
    r = client.post(f"/api/standorte/{sid}/lastgang", files={"datei": ("last.csv", io.BytesIO("\n".join(zeilen).encode()), "text/csv")})
    assert r.status_code == 200 and r.json()["zeilen"] == 96 * 21 and r.json()["temperatur"]
    fp = client.get(f"/api/standorte/{sid}/fahrplan?datum=2026-07-22").json()
    assert fp["zeilen"][40]["last_p50"] == pytest.approx(1.5, abs=0.05)
    assert any("No active asset" in h for h in fp["zusammenfassung"]["hinweise"])
    assert client.delete(f"/api/standorte/{sid}").json()["ok"]


def test_blick_endpunkt(client):
    sid = client.get("/api/standorte").json()[0]["id"]
    r = client.get(f"/api/standorte/{sid}/blick?datum=2026-06-18")
    assert r.status_code == 200
    b = r.json()
    assert len(b["zeiten"]) == 96 and "kennzahlen" in b and len(b["bloecke"]) == 6
    assert b["kennzahlen"]["spitze_nachher"] <= b["kennzahlen"]["spitze_vorher"]


def test_blick_csv(client):
    sid = client.get("/api/standorte").json()[0]["id"]
    r = client.get(f"/api/standorte/{sid}/blick/2026-06-18/fahrplan.csv")
    assert r.status_code == 200
    zeilen = r.text.strip().split("\n")
    assert len(zeilen) == 97 and "aFRR positive MW" in zeilen[0]
