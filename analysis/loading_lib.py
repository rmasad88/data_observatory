"""Download and load TfL cycle hire journeys and docking stations."""

import gzip
import json
from pathlib import Path

import pandas as pd
import requests

# Large enough to keep the number of writes low, small enough to stay light
# on memory
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 60

# Journey CSV columns to keep (post-2022 layout), mapped to short names
JOURNEY_COLUMNS = {
    "Number": "rental_id",
    "Bike number": "bike_id",
    "Start date": "start",
    "Start station number": "start_terminal",
    "End date": "end",
    "End station number": "end_terminal",
    "Bike model": "bike_model",
    "Total duration (ms)": "duration_ms",
}
JOURNEY_DATE_FORMAT = "%Y-%m-%d %H:%M"

# Journey extract analysed throughout: 1-14 July 2024
JOURNEYS_JULY_2024_URL = (
    "https://cycling.data.tfl.gov.uk/usage-stats/"
    "399JourneyDataExtract01Jul2024-14Jul2024.csv"
)

# Live list of docking stations, describing the network today
BIKEPOINT_URL = "https://api.tfl.gov.uk/BikePoint"

# Archived station list from close to the July 2024 journeys; see
# reference/README.md for its source and why it is used
SNAPSHOT_2024_PATH = (
    Path(__file__).resolve().parent
    / "reference"
    / "bikepoint_2024-08-20.json.gz"
)

# Values of the source column added by get_stations
SOURCE_SNAPSHOT_2024 = "2024-08-20 snapshot"
SOURCE_CURRENT = "current list"

# Columns returned by load_stations, in order
STATION_COLUMNS = ["terminal", "name", "lat", "lon", "docks"]


def download_file(
    url: str, dest_dir: Path, filename: str | None = None
) -> Path:
    """Download a file to a local folder, skipping it if already cached.

    Parameters
    ----------
    url : str
        Remote location of the file.
    dest_dir : Path
        Folder to save the file in. Created if it does not exist.
    filename : str, optional
        Local filename to use. Defaults to the last part of the URL, which
        suits files like the journey CSVs but not API endpoints such as
        BikePoint that have no extension.

    Returns
    -------
    Path
        Location of the local file.

    Raises
    ------
    requests.HTTPError
        If the server responds with an error status.
    """
    dest = Path(dest_dir) / (filename or url.rstrip("/").split("/")[-1])
    if dest.exists():
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    # Download to a temporary name first so an interrupted transfer never
    # leaves a partial file that would be mistaken for a cached copy
    partial = dest.with_name(dest.name + ".part")

    # Stream in chunks so large CSVs are never held in memory all at once
    with requests.get(
        url, stream=True, timeout=DOWNLOAD_TIMEOUT_SECONDS
    ) as response:
        response.raise_for_status()
        with open(partial, "wb") as f:
            for chunk in response.iter_content(DOWNLOAD_CHUNK_BYTES):
                f.write(chunk)

    partial.rename(dest)
    return dest


def load_journeys(paths: list[Path]) -> pd.DataFrame:
    """Read one or more journey extracts into a single DataFrame.

    Parameters
    ----------
    paths : list of Path
        Journey CSV extracts using the post-2022 column layout.

    Returns
    -------
    pandas.DataFrame
        One row per journey, with the columns renamed as in
        ``JOURNEY_COLUMNS``, parsed ``start``/``end`` timestamps and
        station numbers kept as strings.

    Raises
    ------
    ValueError
        If ``paths`` is empty.
    """
    # An empty list is almost always a mistake, and pd.concat's own error
    # ("No objects to concatenate") doesn't say what went wrong
    if not paths:
        raise ValueError("load_journeys needs at least one journey file")

    frames = [
        pd.read_csv(
            path,
            usecols=list(JOURNEY_COLUMNS),
            # Keep station numbers as strings so leading zeros survive the
            # join with the BikePoint TerminalName
            dtype={
                "Start station number": str,
                "End station number": str,
                # One journey has no bike number; a nullable integer
                # keeps the rest as whole numbers rather than floats
                "Bike number": "Int64",
            },
        )
        for path in paths
    ]
    df = pd.concat(frames, ignore_index=True).rename(columns=JOURNEY_COLUMNS)
    # usecols keeps the file's column order, so reorder to match
    # JOURNEY_COLUMNS and give the same layout whatever the source file
    df = df[list(JOURNEY_COLUMNS.values())]

    for column in ("start", "end"):
        df[column] = pd.to_datetime(df[column], format=JOURNEY_DATE_FORMAT)
    return df


def load_stations(path: Path) -> pd.DataFrame:
    """Read docking stations from a saved BikePoint API response.

    Parameters
    ----------
    path : Path
        JSON file saved from ``https://api.tfl.gov.uk/BikePoint``. Files
        ending in ``.gz`` are read as gzip-compressed JSON.

    Returns
    -------
    pandas.DataFrame
        One row per station with ``terminal``, ``name``, ``lat``, ``lon``
        and ``docks`` columns. Empty, but with those columns, if the
        response lists no stations.

    Raises
    ------
    KeyError
        If a station is missing its ``TerminalName`` or ``NbDocks``.
    """
    path = Path(path)
    # Archived snapshots are stored gzip-compressed, as the archive
    # served them
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        points = json.load(f)

    rows = []
    for point in points:
        # Terminal number and dock count are nested as key/value pairs
        props = {p["key"]: p["value"] for p in point["additionalProperties"]}
        rows.append(
            {
                # TerminalName matches the journey files' station numbers
                "terminal": props["TerminalName"],
                "name": point["commonName"],
                "lat": point["lat"],
                "lon": point["lon"],
                "docks": int(props["NbDocks"]),
            }
        )
    return pd.DataFrame(rows, columns=STATION_COLUMNS)


def get_stations(source: str, raw_dir: Path) -> pd.DataFrame:
    """Build the station list to use, from the 2024 snapshot or today's list.

    Parameters
    ----------
    source : {"2024", "current"}
        ``"2024"`` uses the archived August 2024 snapshot, adding any
        station it lacks from today's list. ``"current"`` uses today's
        list only, which mislocates some 2024 journeys because TfL has
        since closed stations and reused terminal numbers.
    raw_dir : Path
        Folder where today's BikePoint list is downloaded and cached.

    Returns
    -------
    pandas.DataFrame
        The ``load_stations`` columns plus ``source``, recording which list
        each station's details came from (``SOURCE_SNAPSHOT_2024`` or
        ``SOURCE_CURRENT``).

    Raises
    ------
    ValueError
        If ``source`` is not ``"2024"`` or ``"current"``.
    """
    # Check before downloading anything
    if source not in ("2024", "current"):
        raise ValueError(
            f'source must be "2024" or "current", not {source!r}'
        )

    current_path = download_file(
        BIKEPOINT_URL, raw_dir, filename="bikepoint.json"
    )
    current = load_stations(current_path).assign(source=SOURCE_CURRENT)
    if source == "current":
        return current

    snapshot = load_stations(SNAPSHOT_2024_PATH).assign(
        source=SOURCE_SNAPSHOT_2024
    )
    # Fill gaps only: where both lists have a terminal, the snapshot wins.
    # This also adds stations opened since 2024, which simply have no
    # journeys in the 2024 data.
    gaps = current[~current["terminal"].isin(snapshot["terminal"])]
    return pd.concat([snapshot, gaps], ignore_index=True)
