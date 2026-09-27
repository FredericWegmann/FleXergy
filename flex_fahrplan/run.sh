#!/bin/sh
# Startet den Flex-Fahrplan lokal. Port 8770 ist nur für diese App reserviert.
cd "$(dirname "$0")"
PORT="${PORT:-8770}"
exec ../netz-screening_code/venv/bin/uvicorn src.api:app --host 127.0.0.1 --port "$PORT" --reload
