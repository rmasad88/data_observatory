"""Package estimated journey routes as compact per-day files for the browser.

Each day's file holds the routes ridden on journeys starting that day, the
two stations each route joins and, for each journey, its route, start time
and duration. ``paths.json`` lists the days, the stations and the layout.
See the README's "Journey paths" section.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

EXPORT_INDEX_FILE = "paths.json"
# Coordinates are stored as unsigned 16-bit fractions of the bounding box,
# about 0.3 m apart across central London
COORDINATE_STEPS = 65_535
# Margin added around the routes' bounding box, in degrees
BOUNDS_PADDING_DEGREES = 0.001

U16 = np.dtype("<u2")
U32 = np.dtype("<u4")


@dataclass
class PathDay:
    """The routes and journeys for journeys starting on one day.

    Attributes
    ----------
    date : str
        The day, e.g. ``"2024-07-01"``.
    routes : list of list of (float, float)
        Each distinct route's (lon, lat) points, dock to dock.
    route_pairs : list of (str, str)
        The start and end terminal of each route.
    journey_route : numpy.ndarray
        Index into ``routes`` for each journey, sorted by start time.
    journey_start : numpy.ndarray
        Each journey's start, in seconds since the period's start.
    journey_duration : numpy.ndarray
        Each journey's duration in seconds.
    """

    date: str
    routes: list
    route_pairs: list
    journey_route: np.ndarray
    journey_start: np.ndarray
    journey_duration: np.ndarray


def build_path_days(
    journeys: pd.DataFrame,
    routes: dict,
    period_start: pd.Timestamp,
) -> tuple[list[PathDay], int]:
    """Group journeys by the day they start, with each day's routes.

    Parameters
    ----------
    journeys : pandas.DataFrame
        Cleaned journeys with ``start``, ``start_terminal``,
        ``end_terminal`` and ``duration_ms`` columns, already limited to the
        period.
    routes : dict
        Route points for each (start terminal, end terminal) pair.
    period_start : pandas.Timestamp
        The time journey starts are counted from.

    Returns
    -------
    (list of PathDay, int)
        One entry per day with journeys, in date order, and the number of
        journeys left out because their pair has no route.
    """
    pairs = list(zip(journeys["start_terminal"], journeys["end_terminal"]))
    has_route = np.array([pair in routes for pair in pairs], dtype=bool)
    routed = journeys[has_route].assign(
        pair=[pair for pair, ok in zip(pairs, has_route) if ok]
    )
    routed = routed.sort_values("start", kind="stable")

    days = []
    for date, group in routed.groupby(routed["start"].dt.date):
        # Routes in order of first use, each stored once per day
        route_index: dict = {}
        for pair in group["pair"]:
            route_index.setdefault(pair, len(route_index))
        starts = (group["start"] - period_start).dt.total_seconds()
        days.append(
            PathDay(
                date=str(date),
                routes=[routes[pair] for pair in route_index],
                route_pairs=list(route_index),
                journey_route=group["pair"].map(route_index).to_numpy(),
                journey_start=starts.round().astype(np.int64).to_numpy(),
                journey_duration=(group["duration_ms"] / 1000)
                .round()
                .astype(np.int64)
                .to_numpy(),
            )
        )
    return days, int((~has_route).sum())


def path_bounds(days: list[PathDay]) -> tuple[float, float, float, float]:
    """The (west, south, east, north) box around every route, padded."""
    points = np.array(
        [point for day in days for route in day.routes for point in route]
    )
    pad = BOUNDS_PADDING_DEGREES
    west, south = points.min(axis=0) - pad
    east, north = points.max(axis=0) + pad
    return (float(west), float(south), float(east), float(north))


def quantise(points: np.ndarray, bounds) -> np.ndarray:
    """(lon, lat) points as unsigned 16-bit steps across the bounds."""
    west, south, east, north = bounds
    scale = np.array([east - west, north - south])
    fractions = (np.asarray(points) - [west, south]) / scale
    if (fractions < 0).any() or (fractions > 1).any():
        raise ValueError("A point lies outside the bounds")
    return np.round(fractions * COORDINATE_STEPS).astype(U16)


def dequantise(steps: np.ndarray, bounds) -> np.ndarray:
    """The inverse of ``quantise``, as the browser does it."""
    west, south, east, north = bounds
    fractions = steps.astype(float) / COORDINATE_STEPS
    return fractions * [east - west, north - south] + [west, south]


def path_terminals(days: list[PathDay]) -> list[str]:
    """Every terminal a route starts or ends at, sorted."""
    pairs = [pair for day in days for pair in day.route_pairs]
    return sorted({terminal for pair in pairs for terminal in pair})


def encode_day(day: PathDay, bounds, terminals: list[str]) -> bytes:
    """One day's binary file: route offsets, journey routes, starts and
    durations, each route's two stations (positions in ``terminals``), then
    the points."""
    position = {terminal: i for i, terminal in enumerate(terminals)}
    stations = np.array(
        [[position[a], position[b]] for a, b in day.route_pairs]
    ).reshape(-1)
    lengths = [len(route) for route in day.routes]
    offsets = np.concatenate([[0], np.cumsum(lengths)])
    points = np.array([point for route in day.routes for point in route])

    arrays = [
        _checked(offsets, U32, "route offsets"),
        _checked(day.journey_route, U32, "journey routes"),
        _checked(day.journey_start, U32, "journey starts"),
        _checked(day.journey_duration, U16, "journey durations"),
        _checked(stations, U16, "route stations"),
        quantise(points, bounds).reshape(-1),
    ]
    return b"".join(array.tobytes() for array in arrays)


def _checked(values: np.ndarray, dtype: np.dtype, name: str) -> np.ndarray:
    """Values converted to an unsigned type, refusing any that won't fit."""
    values = np.asarray(values)
    limit = np.iinfo(dtype).max
    if len(values) and (values.min() < 0 or values.max() > limit):
        raise OverflowError(f"{name} don't fit in {dtype}")
    return values.astype(dtype)


def export_path_days(
    days: list[PathDay], period_start: pd.Timestamp, out_dir: Path
) -> list[Path]:
    """Write ``paths.json`` and one binary file per day.

    Returns
    -------
    list of pathlib.Path
        The files written, index first.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    bounds = path_bounds(days)
    terminals = path_terminals(days)
    written = []
    index_days = []
    for day in days:
        path = out_dir / f"{day.date}.bin"
        path.write_bytes(encode_day(day, bounds, terminals))
        written.append(path)
        index_days.append(
            {
                "date": day.date,
                "file": path.name,
                "routes": len(day.routes),
                "points": int(sum(len(route) for route in day.routes)),
                "journeys": int(len(day.journey_route)),
            }
        )

    index = {
        "start": period_start.strftime("%Y-%m-%dT%H:%M:%S"),
        "bounds": list(bounds),
        "coordinateSteps": COORDINATE_STEPS,
        # What routeStations' numbers refer to
        "terminals": terminals,
        "layout": [
            "routeOffsets uint32 (routes + 1)",
            "journeyRoute uint32 (journeys)",
            "journeyStart uint32 seconds since start (journeys)",
            "journeyDuration uint16 seconds (journeys)",
            "routeStations uint16 start, end terminal (routes x 2)",
            "points uint16 x, y pairs (points x 2)",
        ],
        "days": index_days,
    }
    index_path = out_dir / EXPORT_INDEX_FILE
    index_path.write_text(json.dumps(index, indent=1))
    return [index_path, *written]
