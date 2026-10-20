# London Cycle Hire "Heartbeat": Project Plan

Data Observatory demo for the Imperial **Data for Humanity Internship** (Data Science role).

- **Brief:** tell a story using Transport for London Open Data
- **Route:** Developer Playground (this repo), pushed to a public GitHub repo
- **Also needed:** 30-second intro video and CV
- **Submit:** https://tinyurl.com/D4H-2026
- **Closing date:** 20 Nov 2026 · **Interviews:** 9 Dec 2026 (in person)

## Concept

A time-lapse of Santander Cycles across a day. Stations pulse as they get busy, net flow shows the city
"breathing" in and out, and simulated bike journeys animate along plausible cycling routes.

## Data

### Journey data

- Source: https://cycling.data.tfl.gov.uk/ (`usage-stats/`), roughly weekly CSVs going back to 2012
- One row per hire: start and end station, start and end time, duration, bike ID. Newer files also give the bike model (classic or e-bike).
- No GPS traces. All we know is that a bike went from A to B between two times.
- Column names and station ID schemes differ between older and newer files. Check the current format before writing the loader.

### Station locations

- TfL BikePoint API: `https://api.tfl.gov.uk/BikePoint`, giving latitude, longitude and dock count for about 800 stations
- Join to journeys by station ID or name, which will need some cleaning

### Findings (checked 2026-10-20)

- The latest journey file is `400JourneyDataExtract15Jul2024-31Jul2024.csv`; nothing has been published since August 2024.
- Files are now **fortnightly** (about 60–85 MB each), fetched from `https://cycling.data.tfl.gov.uk/usage-stats/<file>`.
- Current columns: `Number, Start date, Start station number, Start station, End date, End station number, End station, Bike number, Bike model (CLASSIC / PBSC_EBIKE), Total duration, Total duration (ms)`
- Timestamps are to the **minute** only.
- Journey `Start/End station number` (e.g. `001023`) matches BikePoint's `TerminalName` property, so the join is clean.
- BikePoint currently returns 801 stations.

### Limitation

- Historical dock occupancy isn't published; the API only gives live counts.
- Rebuild activity from journeys instead: **net flow = departures − arrivals** per station per time bin.

## Simulating routes

**Decision:** route in Python with **osmnx + networkx**. This means no Docker or routing server (Docker isn't installed), and it shows off more Python work.

- Download London's cycleable network once with `ox.graph_from_place("London, UK", network_type="bike")` and cache it to GraphML.
- Snap each station to its nearest graph node with `ox.distance.nearest_nodes`.
- Route unique **start/end station pairs** with `nx.shortest_path(G, a, b, weight="length")`, which uses Dijkstra.
- Optionally add a custom edge weight that penalises main roads, so routes prefer cycle lanes and quiet streets.
- Convert each node path to `[lon, lat]` points, then spread the journey's real start and end times along it in proportion to distance to get the `TripsLayer` timestamps.
- Scope this to one representative weekday and one weekend day (about 25–40k journeys each) and cache the results.
- Speed is about 10–100 ms per route, so a one-off precompute takes minutes to tens of minutes. The graph needs a few GB of RAM.
- Possible extra: edge betweenness or simulated traffic per street, to show London's busiest cycle corridors.
- Animate the routes with **deck.gl `TripsLayer`**, which fits the repo's recommended deck.gl + MapLibre stack.
- Edge cases:
    - **Round trips** (start = end) can't be routed. Show them as a pulse at the station.
    - **Very long journeys** are probably leisure detours. Filter them out, or interpolate along the route at the real duration.
- State on-screen that routes are simulated, not observed.

## Analysis (the data science core)

Do this in Python (pandas/polars, scikit-learn) and export compact JSON or Parquet for the frontend.

1. **Tidal flow:** colour stations by net inflow or outflow. In the morning, rail termini (Waterloo, King's Cross) drain into the City and West End, and in the evening it reverses.
2. **Station "personalities":** cluster stations by their normalised 24-hour usage profile (k-means or hierarchical). Possible groups: commuter origin, commuter destination, leisure/park, nightlife.
3. **Rebalancing pressure:** find which stations run empty or full, and when.
4. **Optional extras:** weekday vs weekend, e-bike vs classic, wet vs dry days (join Met Office weather data).

## Data Observatory layout

- The canvas is 4 rows × 16 columns of 1920×1080 screens (about 30720×4320, roughly 7:1), wrapping 313°.
- **Centre:** the animated map of central London, Hammersmith to Canary Wharf.
- **Side panels:**
    - a 24-hour clock with a departures sparkline
    - the cluster legend
    - a "busiest station right now" ticker
- **`/control` route:**
    - time scrubber
    - play/pause
    - weekday/weekend toggle
    - layer toggles
- Keep rendering iframe-safe, because WebGL context limits are tighter inside iframes (see README).

## Build order

1. Download one week of journeys and the BikePoint data, then clean and join them in a notebook.
2. Build the net-flow "heartbeat" layer, the quick and lower-risk core.
3. Do the station clustering analysis.
4. Route trips with osmnx + networkx, then animate them with `TripsLayer`, the "wow" layer.
5. Fit everything into the starter app's screen layout and add the control panel.
6. Write up the methodology and limitations in the repo README, push it to a public repo, then record the video and submit.

## Progress

### 2026-10-20: MVP heartbeat working

- `analysis/build_heartbeat.py` downloads the 1–14 July 2024 extract and BikePoint stations, then writes departures and arrivals per station in 10-minute bins for **Wed 10 July 2024** to `apps/website/public/data/heartbeat.json` (789 stations, 520 KB).
- `/heartbeat` route (`apps/website/src/routes/heartbeat.tsx`, loader in `src/lib/heartbeat/data.ts`):
    - deck.gl stations on a dark map, sized by activity and coloured red (losing bikes) / blue (gaining)
    - a clock and a citywide sparkline
    - Space pauses; ← → step 10 minutes
- Observed:
    - The morning tide drains Waterloo and King's Cross into the City and West End, and reverses at 17:00–18:00.
    - There's a 22:00 spike. Hypothesis: the England v Netherlands Euro 2024 semi-final finished around then. **To verify.**
- **Environment:** conda env `d4h` (Python 3.12, Node 22, pnpm).
    - The shell PATH puts `npp2026/bin` first, so `conda run -n d4h python` picks up the wrong Python.
    - Instead call `~/miniconda3/envs/d4h/bin/python` directly, or `conda activate d4h`.
    - Start the dev server with `pnpm run dev`, then open http://localhost:5780/heartbeat.

### Next

- Wire `/heartbeat` into the wall: per-tile cameras as in `/screen`, and a shared clock over the bus so all tiles stay in sync.
- Move playback (play/pause, scrub, speed) onto `/control`.
- Iframe-safe fallback renderer (see BEST_PRACTICES §7).
- Verify the 22:00 spike, then add the weekday vs weekend comparison.
