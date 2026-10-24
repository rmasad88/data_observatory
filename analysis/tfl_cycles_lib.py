"""Reusable functions for loading, cleaning and aggregating TfL cycle hire
data."""

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
    """
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
        JSON file saved from ``https://api.tfl.gov.uk/BikePoint``.

    Returns
    -------
    pandas.DataFrame
        One row per station with ``terminal``, ``name``, ``lat``, ``lon``
        and ``docks`` columns.
    """
    rows = []
    for point in json.loads(Path(path).read_text()):
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
    return pd.DataFrame(rows)

def test_function():
    print("This is a test function in tfl_cycles_lib.py")

