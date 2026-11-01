"""Build the station heartbeat dataset for the Data Observatory website.

Downloads the July 2024 journeys and today's station list (cached in
analysis/data/raw/), cleans the journeys, counts departures and arrivals per
station per 10 minutes, and writes the result to
apps/website/public/data/heartbeat/.

Run from anywhere, e.g. from the repository root:

    python analysis/build_heartbeat.py
"""

from pathlib import Path

import pandas as pd

from cleaning_lib import clean_journeys
from heartbeat_lib import build_heartbeat, export_heartbeat
from loading_lib import (
    JOURNEYS_JULY_2024_URL,
    download_file,
    get_stations,
    load_journeys,
)

ANALYSIS_DIR = Path(__file__).resolve().parent
RAW_DIR = ANALYSIS_DIR / "data" / "raw"
OUTPUT_DIR = (
    ANALYSIS_DIR.parent / "apps" / "website" / "public" / "data" / "heartbeat"
)

JOURNEY_URLS = [JOURNEYS_JULY_2024_URL]
# The period shown, including the start and excluding the end
PERIOD_START = pd.Timestamp("2024-07-01")
PERIOD_END = pd.Timestamp("2024-07-15")
STATION_SOURCE = "2024"


def main():
    journeys = load_journeys(
        [download_file(url, RAW_DIR) for url in JOURNEY_URLS]
    )
    stations = get_stations(STATION_SOURCE, RAW_DIR)
    cleaned = clean_journeys(journeys, stations)
    heartbeat = build_heartbeat(cleaned, stations, PERIOD_START, PERIOD_END)
    written = export_heartbeat(heartbeat, OUTPUT_DIR)

    n_stations, n_bins = heartbeat.departures.shape
    print(f"Kept {len(cleaned):,} of {len(journeys):,} journeys")
    print(f"Heartbeat: {n_stations} stations x {n_bins} bins")
    for path in written:
        print(f"Wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
