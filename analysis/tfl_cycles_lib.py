"""Reusable functions for loading, cleaning and aggregating TfL cycle hire
data."""

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

# Relocated stations appear in journeys as their current terminal
# number plus this suffix, e.g. 001020444 for 001020 (named "..._OLD")
RELOCATED_SUFFIX = "444"
TERMINAL_LENGTH = 6

# Same-station hires shorter than this are treated as false starts,
# e.g. a faulty bike docked straight back
FALSE_START_MAX_MS = 60_000

# Hires longer than this are dropped: we can't know where the bike went,
# so a route between its two stations would be meaningless
LONG_HIRE_MAX_MS = 2 * 60 * 60 * 1000

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


def map_relocated_terminals(journeys: pd.DataFrame) -> pd.DataFrame:
    """Replace relocated stations' old terminal numbers with current ones.

    Parameters
    ----------
    journeys : pandas.DataFrame
        Journeys as returned by ``load_journeys``.

    Returns
    -------
    pandas.DataFrame
        A copy in which terminals of the form ``<terminal>444`` are mapped
        to ``<terminal>``. Other terminals are unchanged, including six-digit
        ones that happen to end in 444.
    """
    journeys = journeys.copy()
    old_length = TERMINAL_LENGTH + len(RELOCATED_SUFFIX)
    for column in ("start_terminal", "end_terminal"):
        terminals = journeys[column]
        relocated = (terminals.str.len() == old_length) & (
            terminals.str.endswith(RELOCATED_SUFFIX)
        )
        journeys.loc[relocated, column] = terminals[relocated].str[
            :TERMINAL_LENGTH
        ]
    return journeys


def drop_unknown_stations(
    journeys: pd.DataFrame, stations: pd.DataFrame
) -> pd.DataFrame:
    """Drop journeys that start or end at a terminal not in ``stations``.

    With the 2024 station list and relocations mapped, the only unknown
    terminals in July 2024 are TfL's mechanical workshops, whose bike moves
    are maintenance rather than customer journeys.

    Parameters
    ----------
    journeys : pandas.DataFrame
        Journeys as returned by ``load_journeys``.
    stations : pandas.DataFrame
        Station list with a ``terminal`` column.

    Returns
    -------
    pandas.DataFrame
        The journeys at known stations, with a fresh index.
    """
    known = stations["terminal"]
    keep = journeys["start_terminal"].isin(known) & journeys[
        "end_terminal"
    ].isin(known)
    return journeys[keep].reset_index(drop=True)


def drop_false_starts(journeys: pd.DataFrame) -> pd.DataFrame:
    """Drop same-station hires shorter than ``FALSE_START_MAX_MS``.

    Parameters
    ----------
    journeys : pandas.DataFrame
        Journeys as returned by ``load_journeys``.

    Returns
    -------
    pandas.DataFrame
        The journeys without false starts, with a fresh index. Short hires
        between different stations are kept.
    """
    false_start = (journeys["start_terminal"] == journeys["end_terminal"]) & (
        journeys["duration_ms"] < FALSE_START_MAX_MS
    )
    return journeys[~false_start].reset_index(drop=True)


def drop_long_hires(journeys: pd.DataFrame) -> pd.DataFrame:
    """Drop hires longer than ``LONG_HIRE_MAX_MS``.

    Parameters
    ----------
    journeys : pandas.DataFrame
        Journeys as returned by ``load_journeys``.

    Returns
    -------
    pandas.DataFrame
        The journeys no longer than the limit, with a fresh index.
    """
    keep = journeys["duration_ms"] <= LONG_HIRE_MAX_MS
    return journeys[keep].reset_index(drop=True)


def clean_journeys(
    journeys: pd.DataFrame, stations: pd.DataFrame
) -> pd.DataFrame:
    """Apply all cleaning rules to the journeys.

    Relocated terminals are mapped first, so their journeys are kept by
    ``drop_unknown_stations``.

    Parameters
    ----------
    journeys : pandas.DataFrame
        Journeys as returned by ``load_journeys``.
    stations : pandas.DataFrame
        Station list, e.g. from ``get_stations("2024", ...)``.

    Returns
    -------
    pandas.DataFrame
        The cleaned journeys.
    """
    journeys = map_relocated_terminals(journeys)
    journeys = drop_unknown_stations(journeys, stations)
    journeys = drop_false_starts(journeys)
    return drop_long_hires(journeys)
