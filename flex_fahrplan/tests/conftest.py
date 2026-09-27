import os
import pathlib
import sys

import pytest

BASIS = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASIS))


@pytest.fixture(scope="session")
def db_pfad(tmp_path_factory):
    pfad = tmp_path_factory.mktemp("flex") / "test.db"
    os.environ["FLEX_DB"] = str(pfad)
    return str(pfad)


@pytest.fixture(scope="session")
def con(db_pfad):
    from src import db
    return db.verbinden(db_pfad)


@pytest.fixture(scope="session")
def sid(con):
    from datetime import date
    from src import synth
    return synth.standort_kuehlhaus_anlegen(con, date(2026, 9, 27), seed=3, skalierung=1.0)
