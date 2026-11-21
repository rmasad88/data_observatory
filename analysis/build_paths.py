"""Build the estimated journey paths for the website.

Cleans the July 2024 journeys as build_heartbeat.py does, downloads
OpenStreetMap's cycleable streets around the stations (cached in
analysis/data/osm/), routes every pair of stations ridden between along the
cheapest cycle-friendly path, and writes one file per day to
apps/website/public/data/paths/.

Run from anywhere, e.g. from the repository root:

    python analysis/build_paths.py
"""

from pathlib import Path

import pandas as pd

from cleaning_lib import clean_journeys
from loading_lib import (
    JOURNEYS_JULY_2024_URL,
    download_file,
    get_stations,
    load_journeys,
)
from paths_lib import build_path_days, export_path_days
from routing_lib import (
    load_bike_network,
    route_pairs,
    snap_stations,
    station_route,
    weight_network,
)

ANALYSIS_DIR = Path(__file__).resolve().parent
RAW_DIR = ANALYSIS_DIR / "data" / "raw"
NETWORK_PATH = ANALYSIS_DIR / "data" / "osm" / "london_bike.graphml"
OUTPUT_DIR = (
    ANALYSIS_DIR.parent / "apps" / "website" / "public" / "data" / "paths"
)

JOURNEY_URLS = [JOURNEYS_JULY_2024_URL]
# The same period as the heartbeat: including the start, excluding the end
PERIOD_START = pd.Timestamp("2024-07-01")
PERIOD_END = pd.Timestamp("2024-07-15")
STATION_SOURCE = "2024"
# Routes are simplified until they stray at most this far from the streets:
# under the Data Observatory wall's ~3 m pixels x a few, invisible on a laptop
ROUTE_TOLERANCE_METERS = 10


def main():
    journeys = load_journeys(
        [download_file(url, RAW_DIR) for url in JOURNEY_URLS]
    )
    stations = get_stations(STATION_SOURCE, RAW_DIR)
    cleaned = clean_journeys(journeys, stations)
    in_period = cleaned[
        (cleaned["start"] >= PERIOD_START) & (cleaned["start"] < PERIOD_END)
    ]
    # A hire returned to the station it started from has no known route
    ridden = in_period[
        in_period["start_terminal"] != in_period["end_terminal"]
    ]

    terminals = pd.unique(
        pd.concat([ridden["start_terminal"], ridden["end_terminal"]])
    )
    used = stations.set_index("terminal").loc[terminals].reset_index()
    network = weight_network(load_bike_network(used, NETWORK_PATH))
    node_of = dict(zip(used["terminal"], snap_stations(network, used)))
    position_of = dict(zip(used["terminal"], zip(used["lon"], used["lat"])))

    station_pairs = set(
        zip(ridden["start_terminal"], ridden["end_terminal"])
    )
    node_pairs = {(node_of[a], node_of[b]) for a, b in station_pairs}
    paths = route_pairs(
        network, [(start, end) for start, end in node_pairs if start != end]
    )

    routes = {}
    for a, b in station_pairs:
        start, end = node_of[a], node_of[b]
        # Two stations on the same junction are joined by a straight line
        path = [start] if start == end else paths.get((start, end))
        if path is not None:
            routes[(a, b)] = station_route(
                network,
                path,
                position_of[a],
                position_of[b],
                ROUTE_TOLERANCE_METERS,
            )

    days, unrouted = build_path_days(ridden, routes, PERIOD_START)
    written = export_path_days(days, PERIOD_START, OUTPUT_DIR)

    print(
        f"{len(ridden):,} journeys between different stations; "
        f"{unrouted:,} without a route"
    )
    print(f"Routed {len(routes):,} of {len(station_pairs):,} station pairs")
    total = sum(path.stat().st_size for path in written)
    print(f"Wrote {len(written)} files to {OUTPUT_DIR} ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
