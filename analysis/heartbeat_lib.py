"""Aggregate cleaned journeys into per-station activity over time."""

from dataclasses import dataclass

import numpy as np
import pandas as pd

# Short enough to keep the commuter peaks sharp, long enough that busy
# stations see several events per bin
BIN_MINUTES = 10


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
