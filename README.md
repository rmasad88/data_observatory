# DO App Kit

A starter for creating DO custom applications.

This starter repo is built with Vite+.

## Analysis and data

The visualisation data is produced by a Python pipeline in `analysis/`, from
TfL Santander Cycles journeys for 1–14 July 2024.

```
loading_lib    download and read journeys and docking stations
cleaning_lib   fix and filter journeys
heartbeat_lib  count departures and arrivals per station per 10 minutes
```

`analysis/analysis.ipynb` explores the data and explains each decision. Tests
for each library are in `analysis/tests/`.

### Running it

```bash
conda env create -f analysis/environment.yml   # once
conda activate d4h
python analysis/build_heartbeat.py             # regenerate the data
cd analysis && pytest                          # run the tests
```

Downloads are cached in `analysis/data/raw/` (not committed).

### Generated data

`build_heartbeat.py` writes two files to `apps/website/public/data/heartbeat/`.
They are committed so the website runs without Python; regenerate them after
changing the pipeline.

- `stations.json`: the period start, bin size, data layout, and each active
  station's terminal, name, `[lon, lat]` position, dock count and source list.
- `counts.bin`: departures then arrivals, each a stations × bins block in row
  order (one station's bins together), as little-endian unsigned 16-bit
  integers. Read it in the browser as a `Uint16Array`.

### Cleaning decisions

- **Station list:** station locations come from an archived August 2024 copy
  of TfL's BikePoint API, because today's list has closed stations and reused
  terminal numbers (see `analysis/reference/README.md`). Stations missing from
  the archive are filled in from today's list, and each station records which
  list it came from.
- **Journeys:** relocated stations are mapped to their current terminal
  number; TfL workshop moves, same-station hires under 1 minute (false starts)
  and hires over 2 hours are dropped. 98.6% of journeys are kept.

## Runtime Context Note (Top-Level vs Iframe)

Data Observatory deployments may render an app either:

- as a top-level document, or
- inside one or more iframes (for multi-screen orchestration/simulation).

This matters for graphics-heavy features: iframe-based deployments can increase pressure on
browser/GPU context limits (especially with WebGL). For that reason, this example includes
runtime-aware rendering decisions and fallback strategies so behavior remains stable in both modes.

## Stack Used In This Example

The example app in `apps/website` focuses on three package groups:

- `@tanstack/react-router`: file-based routing and route-level app structure (`/`, `/control`, `/screen`, `/bus`).
- `@tanstack/pacer`: throttling of high-frequency control events before broadcast (for example slider updates).
- Mapping stack:
  `maplibre-gl`, `@vis.gl/react-maplibre`, `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/react`.
  These are used to render the map, draw animated paths/markers, and support both richer and iframe-safe rendering paths. We strongly recommend the use of Deck.GL with MapLibre as the DO natively supports them.
- `vite-plus` (`vp`): monorepo task runner/repo manager used for project commands (`vp run dev`, `vp run build -r`, etc.).

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the tests:

```bash
vp run test -r
```

- Build the monorepo:

```bash
vp run build -r
```

- Run the development server:

```bash
vp run dev
```
