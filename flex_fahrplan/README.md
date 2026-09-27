# Flex Schedule

One flex schedule per site: for each of the 96 quarter hours of the next day,
how many MW up (load reduction) and down (load increase), for how long, with
what confidence. Plus the proof that the baseline is right, and a dashboard
that shows in 30 seconds what the product does: balancing reserve held, peak
shaved, energy shifted, and what it is worth per day and per year.

The site delivers the numbers and the proof. Control, prequalification,
balancing group and bidding are done by the pool operator.

## Start

```bash
./run.sh
```

Opens http://127.0.0.1:8770. Port 8770 belongs to this app only.
The venv lives in the neighbouring folder `netz-screening_code/venv` (FastAPI,
Pandas, NumPy, SciPy). LightGBM is optional: if installed, the forecast method
can be switched per site, otherwise the day-type method is used.

On first start the database is empty. The button "Create example cold store"
creates a generic example plant with about 1 MW of flexible power (the physics
of a cold store, scaled by 0.5, `POST /api/standorte/beispiel?skalierung=1`
gives the full 4.8 MW plant) with 12 months of quarter-hour load data,
temperature, production plan, historical calls and example prices. Real
day-ahead prices come from SMARD (see below).

Tests:

```bash
../netz-screening_code/venv/bin/python -m pytest tests -q
```

## Dashboard (start page)

One plant, one day, before and after. Values on the tiles are ranges, not
points: the optimisation runs twice, with the safe (P10) and the expected (P50)
flexibility, and the year range is widened by the spread over the months
(12 times the first and third quartile of the monthly values). Numbers are
rounded to two significant digits. A row of numbers (balancing reserve
held positive and negative, revenue of the day, peak shaved, energy shifted),
the year estimate, two charts side by side (load before and after with the
balancing reserve as a band, flexible power per quarter hour as used, held and
free) and the end product: the 96 quarter hours as a colour strip and as a
table with CSV export. Price, revenue per quarter hour, the four-hour blocks
and the derivation are collapsed below. Default day is 18 June 2026, the date
can be changed.

Behind-the-meter optimisation (`src/blick.py`), balancing reserve as the main goal:

1. **Peak shaving.** The lowest target peak reachable with the safe load
   reduction (P10). Each stretch above the cap is at most as long as the
   longest call duration, at most as large as the buffer of the assets, with
   recovery time between two stretches. Catch-up only below the cap, spread
   evenly. Value: shaved peak times demand charge per kW and year (assumption
   per site, default 120), valid if the day sets the annual peak.
2. **Day-ahead shifting per four-hour block** (reduction in the expensive
   block, catch-up or pull-forward in the cheap one, energy per shift at most
   the buffer), but only if it earns more than the balancing reserve given up
   for it. Two reduction blocks are never adjacent.
3. **Balancing reserve per quarter hour.** Assumption: aFRR is procured in
   quarter-hour products. Everything left of aFRR-capable power after peak
   shaving and shifting is held positive and negative and valued at the
   assumed capacity price (default 12 EUR per MW and hour positive, 8
   negative). Negative only as far as a call stays below the target peak.
   Activation payments are not counted. The annual figure is day times 365
   and labelled as such.

**Year estimate** (`src/jahr.py`): the same optimisation over every complete
day of the last 12 months, computed in the background with a progress bar and
cached per data version in the table `jahr_cache`. Balancing reserve and
day-ahead are scaled to 365 days, peak shaving compares the annual peak before
and after. Monthly breakdown as a chart.

Day-ahead prices come from SMARD (Bundesnetzagentur), series 4169
Germany/Luxembourg, quarter hour: `python -m src.preise_smard 2025-10-01
2026-09-28` or `POST /api/preise/smard?von&bis`. Example prices of the
synthetic site never overwrite real prices. Balancing capacity prices (FCR, aFRR, mFRR per four-hour block) come from a
CSV file: `python -m src.kapazitaet data/kapazitaetspreise_2025-09-27_2026-09-27.csv`
or `POST /api/preise/kapazitaet/upload`. Where a day has prices in the file,
the optimisation values aFRR with them per quarter hour, otherwise with the
assumption per site.

## Definition of flexible power

Flexible power of an asset in a quarter hour is the minimum of four limits.
Each limit is a value in MW, the smallest wins and is named.

| Limit | What it checks | Parameters |
|---|---|---|
| Technical | rated power, minimum load, ramp | `p_nenn_mw`, `p_min_mw`, `rampe_mw_min` |
| Process | block in the production plan, goods intake above the limit, maximum call duration | `plan_grenze_t_h`, `max_dauer_min`, plan per hour |
| Energy | buffer (cold in the goods, storage) and catch-up from the previous day | `puffer_mwh`, `puffer_start_prozent`, `nachhol_mwh` |
| Contract | release windows of the plant per weekday with upper limits | table `fenster` |

The expected load of an asset is its load share times the forecast of the
site, at most the rated power. Switchable blocks (defrost) run at fixed times
and can be shifted.

Duration: minimum of maximum call duration, buffer divided by expected load
and the rest of the release window. Products by ramp and duration:

| Product | full power after | sustainable at least |
|---|---|---|
| aFRR | 5 min | 15 min (assumption: quarter-hour product) |
| mFRR | 12.5 min | 240 min |
| Intraday 15 min | 15 min | 15 min |

Per quarter hour the powers sustainable for 15 min, 1 h and 4 h stand side by
side. Per four-hour block mFRR counts the minimum over the 16 quarter hours,
where each asset must be sustainable until the end of the block. For aFRR each
quarter hour counts on its own. The exports carry aFRR positive and negative
per quarter hour as separate columns.

## Computation

1. **Baseline** (`src/baseline.py`): median per quarter hour of the last 8
   weeks, separated by weekday, Saturday, Sunday or holiday. Then two
   coefficients from a linear regression of the deviations: MW per degree of
   outside temperature, MW per ton per hour of goods intake. Band P10 to P90
   from the errors of the backtest per day type and hour. Optional LightGBM
   quantile regression.
2. **Flex per asset** (`src/flex.py`): deterministic rules, see above.
3. **Aggregation** (`src/fahrplan.py`): sum over the assets. The schedule is
   computed three times, with the load P50, P10 and P90. Marketed is P10: for
   load reduction the run with the low load, for load increase the one with
   the high load. The safety margin is the difference P50 minus P10. An
   additional margin per site is possible.
4. **Product check**: per asset from ramp and duration, per quarter hour as a
   sum. The product label of a quarter hour is the best tier that carries at
   least half of the power.
5. **Confidence**: high if P10 is at least 80 percent of P50, medium from 50
   percent, otherwise low.

## Backtest and verification

`src/nachweis.py` computes each of the last 90 days as a day-ahead forecast
using only the data before it. Metrics: MAE in MW and in percent of peak load
(target below 5 percent), coverage of the band (band from the first 45 days,
tested on the second 45), error per day and per hour, distribution.
Calls are assessed against the baseline: delivered is baseline minus actual in
the call window, the delivery rate is energy weighted and capped at 100
percent per call (target above 95 percent).

In the backtest the measured temperature of the day is used as the forecast.

## Approval

Every schedule starts as a draft. Flow: draft, approval requested, approved or
rejected. The availability report for the pool operator exists only after
approval. Every recomputation turns the approval back into a draft.

## Files and formats

- Load data CSV: time column (`time`, or `date` and `time of day`), power in
  `p_mw` or `p_kw` (a column name with kW is divided by 1000), optional
  `temp_c`. Separator semicolon, comma or tab, decimal comma allowed.
  Rows with temperature and empty power are the temperature forecast.
- Production plan CSV: time, `intake` (t/h), `shift`, `block`.
  Hourly values are spread over quarter hours.
- Prices CSV: time, `eur_mwh`. `POST /api/preise/upload`.
- Exports (comma separated, dot as decimal point): schedule as CSV and JSON,
  availability report (integer kW, P10, aFRR positive and negative, generic
  column layout), verification report as CSV, optimised day schedule with 96
  quarter hours as CSV.

Times are local time without time zone, every day has 96 quarter hours, also
on the days of the clock change.

## Layout

```
src/db.py          SQLite, schema, read and write functions
src/synth.py       synthetic cold store site
src/baseline.py    forecast and backtest
src/flex.py        flexible power per asset
src/fahrplan.py    schedule per day, aggregation, blocks, summary
src/nachweis.py    accuracy, calls, verification report
src/blick.py       dashboard, behind-the-meter optimisation
src/jahr.py        year estimate in the background
src/preise_smard.py  day-ahead prices from SMARD
src/kapazitaet.py  balancing capacity prices from CSV
src/export.py      CSV and JSON
src/einlesen.py    CSV import
src/api.py         FastAPI, serves web/
web/               index.html, style.css, app.js, blick.js (no framework)
tests/             pytest
data/flex.db       database (path via FLEX_DB)
```

Identifiers in the code are German (Fahrplan, Anlage, Fenster). The user
interface, API messages, exports and this document are English.

## What the MVP deliberately does not do

No asset control, no prequalification, no balancing group, no bidding, no
live connection. The recovery time between calls is a parameter but does not
enter the computation, because the day-ahead schedule knows no calls. The
upload format of the pool operator is generic and must be adapted per
operator. Discrete manufacturing is not covered. Balancing capacity prices
and the demand charge are assumptions per site.
