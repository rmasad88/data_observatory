"""Aggregate cleaned journeys into per-station activity over time."""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

# Short enough to keep the commuter peaks sharp, long enough that busy
# stations see several events per bin
BIN_MINUTES = 10

# Exported counts are little-endian unsigned 16-bit integers, which the
# browser reads directly as a Uint16Array
EXPORT_DTYPE = np.dtype("<u2")
EXPORT_METADATA_FILE = "stations.json"
EXPORT_COUNTS_FILE = "counts.bin"
# Five decimal places is about 1 m, plenty for station markers
COORDINATE_DECIMALS = 5


@dataclass
class Heartbeat:
    """Departures and arrivals per station per time bin.

    Attributes
    ----------
    stations : pandas.DataFrame
        Stations with at least one event, in the same order as the rows of
        ``departures`` and ``arrivals``.
    bin_starts : pandas.DatetimeIndex
        Start time of each bin, matching the columns of the count arrays.
    departures : numpy.ndarray
        Hires starting at each station in each bin, shape
        (stations, bins).
    arrivals : numpy.ndarray
        Hires ending at each station in each bin, same shape.
    """

    stations: pd.DataFrame
    bin_starts: pd.DatetimeIndex
    departures: np.ndarray
    arrivals: np.ndarray


def count_events(
    times: pd.Series,
    terminals: pd.Series,
    station_terminals: pd.Index,
    start: pd.Timestamp,
    n_bins: int,
    bin_minutes: int = BIN_MINUTES,
) -> np.ndarray:
    """Count events per station per time bin.

    Parameters
    ----------
    times : pandas.Series
        Time of each event, e.g. journey start times for departures.
    terminals : pandas.Series
        Station terminal of each event, aligned with ``times``.
    station_terminals : pandas.Index
        Terminals in the order of the output rows. Every value of
        ``terminals`` must be in it.
    start : pandas.Timestamp
        Start of the first bin.
    n_bins : int
        Number of bins. Events before ``start`` or after the last bin are
        ignored.
    bin_minutes : int, optional
        Width of each bin.

    Returns
    -------
    numpy.ndarray
        Integer counts of shape (len(station_terminals), n_bins).

    Raises
    ------
    ValueError
        If an event's terminal is not in ``station_terminals``.
    """
    rows = station_terminals.get_indexer(terminals)
    if (rows < 0).any():
        unknown = sorted(set(terminals[rows < 0]))
        raise ValueError(f"Events at stations not in the list: {unknown}")

    # Floor division puts an event exactly on a boundary in the later bin
    bins = ((times - start) // pd.Timedelta(minutes=bin_minutes)).to_numpy()
    inside = (bins >= 0) & (bins < n_bins)

    counts = np.zeros((len(station_terminals), n_bins), dtype=np.int32)
    # add.at accumulates repeated (row, bin) pairs, unlike plain indexing
    np.add.at(counts, (rows[inside], bins[inside]), 1)
    return counts


def build_heartbeat(
    journeys: pd.DataFrame,
    stations: pd.DataFrame,
    start: pd.Timestamp,
    end: pd.Timestamp,
    bin_minutes: int = BIN_MINUTES,
) -> Heartbeat:
    """Count departures and arrivals per station across a period.

    Each hire contributes a departure in the bin of its start time and an
    arrival in the bin of its end time, so a hire crossing a bin boundary
    (or midnight) is counted in two different bins.

    Parameters
    ----------
    journeys : pandas.DataFrame
        Cleaned journeys, e.g. from ``cleaning_lib.clean_journeys``.
    stations : pandas.DataFrame
        Station list with a ``terminal`` column covering every journey.
    start, end : pandas.Timestamp
        The period to cover, including ``start`` and excluding ``end``.
    bin_minutes : int, optional
        Width of each bin.

    Returns
    -------
    Heartbeat
        Counts for the stations with at least one event in the period.

    Raises
    ------
    ValueError
        If ``end`` is not after ``start``, the period is not a whole number
        of bins, or a journey uses a station not in ``stations``.
    """
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    bin_width = pd.Timedelta(minutes=bin_minutes)
    if end <= start:
        raise ValueError("end must be after start")
    if (end - start) % bin_width:
        raise ValueError(
            f"Period must be a whole number of {bin_minutes}-minute bins"
        )

    n_bins = (end - start) // bin_width
    terminals = pd.Index(stations["terminal"])
    departures = count_events(
        journeys["start"], journeys["start_terminal"], terminals, start,
        n_bins, bin_minutes,
    )
    arrivals = count_events(
        journeys["end"], journeys["end_terminal"], terminals, start,
        n_bins, bin_minutes,
    )

    # Drop stations with no events, e.g. ones opened after the period
    active = (departures.sum(axis=1) + arrivals.sum(axis=1)) > 0
    return Heartbeat(
        stations=stations[active].reset_index(drop=True),
        bin_starts=pd.date_range(start, periods=n_bins, freq=bin_width),
        departures=departures[active],
        arrivals=arrivals[active],
    )


def export_heartbeat(heartbeat: Heartbeat, out_dir: Path) -> list[Path]:
    """Write a heartbeat as station metadata (JSON) plus counts (binary).

    ``stations.json`` holds the period, bin size, data layout and station
    details. ``counts.bin`` holds all departures followed by all arrivals,
    each as a stations x bins block in row order (one station's bins
    together), as ``EXPORT_DTYPE`` values.

    Parameters
    ----------
    heartbeat : Heartbeat
        Result of ``build_heartbeat``.
    out_dir : Path
        Folder to write to. Created if it does not exist.

    Returns
    -------
    list of Path
        The metadata and counts files written.

    Raises
    ------
    ValueError
        If a count is too large for ``EXPORT_DTYPE``.
    """
    largest = max(heartbeat.departures.max(), heartbeat.arrivals.max())
    if largest > np.iinfo(EXPORT_DTYPE).max:
        raise ValueError(
            f"A count of {largest} does not fit in {EXPORT_DTYPE.name}"
        )

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    bin_minutes = (heartbeat.bin_starts[1] - heartbeat.bin_starts[0]) // (
        pd.Timedelta(minutes=1)
    )
    n_stations, n_bins = heartbeat.departures.shape

    metadata = {
        "start": heartbeat.bin_starts[0].isoformat(),
        "binMinutes": int(bin_minutes),
        "binCount": n_bins,
        "stationCount": n_stations,
        "counts": {
            "file": EXPORT_COUNTS_FILE,
            "dtype": "uint16-le",
            "blocks": ["departures", "arrivals"],
            "shape": [n_stations, n_bins],
        },
        "stations": [
            {
                "terminal": row.terminal,
                "name": row.name,
                "position": [
                    round(row.lon, COORDINATE_DECIMALS),
                    round(row.lat, COORDINATE_DECIMALS),
                ],
                "docks": int(row.docks),
                "source": row.source,
            }
            for row in heartbeat.stations.itertuples()
        ],
    }
    metadata_path = out_dir / EXPORT_METADATA_FILE
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False))

    counts_path = out_dir / EXPORT_COUNTS_FILE
    counts = np.concatenate([heartbeat.departures, heartbeat.arrivals])
    counts.astype(EXPORT_DTYPE).tofile(counts_path)
    return [metadata_path, counts_path]
