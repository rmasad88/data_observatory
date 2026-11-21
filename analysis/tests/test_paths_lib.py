"""Tests for paths_lib, on small made-up journeys and routes."""

import json

import numpy as np
import pandas as pd
import pytest

from paths_lib import (
    COORDINATE_STEPS,
    build_path_days,
    dequantise,
    encode_day,
    export_path_days,
    path_bounds,
    path_terminals,
    quantise,
)

PERIOD_START = pd.Timestamp("2024-07-01")

ROUTES = {
    ("A", "B"): [(-0.10, 51.50), (-0.095, 51.505), (-0.09, 51.50)],
    ("B", "A"): [(-0.09, 51.50), (-0.10, 51.50)],
}


def make_journeys():
    """Three routed journeys over two days, given out of order, and one
    between stations with no route."""
    return pd.DataFrame(
        {
            "start": pd.to_datetime(
                [
                    "2024-07-01 08:30",
                    "2024-07-01 08:00",
                    "2024-07-02 23:50",
                    "2024-07-01 09:00",
                ]
            ),
            "start_terminal": ["B", "A", "A", "A"],
            "end_terminal": ["A", "B", "B", "C"],
            "duration_ms": [600_000, 900_000, 1_200_400, 300_000],
        }
    )


def test_build_path_days_groups_journeys_by_start_day():
    days, unrouted = build_path_days(make_journeys(), ROUTES, PERIOD_START)

    assert [day.date for day in days] == ["2024-07-01", "2024-07-02"]
    assert unrouted == 1


def test_build_path_days_sorts_journeys_and_stores_each_route_once():
    first, second = build_path_days(make_journeys(), ROUTES, PERIOD_START)[0]

    # Sorted by start: 08:00 A to B, then 08:30 B to A
    assert first.routes == [ROUTES[("A", "B")], ROUTES[("B", "A")]]
    assert first.route_pairs == [("A", "B"), ("B", "A")]
    assert list(first.journey_route) == [0, 1]
    assert list(first.journey_start) == [8 * 3600, 8.5 * 3600]
    assert list(first.journey_duration) == [900, 600]
    # The second day stores its own copy of the route it uses
    assert second.routes == [ROUTES[("A", "B")]]
    # Counted from the period's start, so a ride crossing midnight is placed
    # correctly; durations round to whole seconds
    assert list(second.journey_start) == [(24 + 23) * 3600 + 50 * 60]
    assert list(second.journey_duration) == [1200]


def test_quantise_round_trips_within_a_step():
    bounds = (-0.2, 51.4, 0.0, 51.6)
    points = np.array([(-0.2, 51.4), (-0.1234567, 51.5123456), (0.0, 51.6)])

    steps = quantise(points, bounds)

    assert steps.dtype == np.dtype("<u2")
    assert steps[0].tolist() == [0, 0]
    assert steps[2].tolist() == [COORDINATE_STEPS, COORDINATE_STEPS]
    # Half a step of 0.2 degrees is about 1.5e-6 degrees
    np.testing.assert_allclose(dequantise(steps, bounds), points, atol=2e-6)


def test_quantise_refuses_points_outside_the_bounds():
    with pytest.raises(ValueError):
        quantise(np.array([(0.5, 51.5)]), (-0.2, 51.4, 0.0, 51.6))


def test_path_bounds_cover_every_point():
    days, _ = build_path_days(make_journeys(), ROUTES, PERIOD_START)
    west, south, east, north = path_bounds(days)

    assert west < -0.10 and east > -0.09
    assert south < 51.50 and north > 51.505


def test_path_terminals_lists_each_route_end_once():
    days, _ = build_path_days(make_journeys(), ROUTES, PERIOD_START)

    # C has no route, so it isn't listed
    assert path_terminals(days) == ["A", "B"]


def test_encode_day_lays_out_arrays_in_order():
    day = build_path_days(make_journeys(), ROUTES, PERIOD_START)[0][0]
    bounds = (-0.2, 51.4, 0.0, 51.6)

    # B is listed first, so the routes' stations are A=1, B=0
    data = encode_day(day, bounds, ["B", "A"])

    offsets = np.frombuffer(data, "<u4", count=3)
    journeys = np.frombuffer(data, "<u4", count=4, offset=12)
    durations = np.frombuffer(data, "<u2", count=2, offset=28)
    stations = np.frombuffer(data, "<u2", count=4, offset=32)
    points = np.frombuffer(data, "<u2", offset=40).reshape(-1, 2)
    assert offsets.tolist() == [0, 3, 5]
    assert journeys.tolist() == [0, 1, 8 * 3600, int(8.5 * 3600)]
    assert durations.tolist() == [900, 600]
    assert stations.tolist() == [1, 0, 0, 1]
    np.testing.assert_allclose(
        dequantise(points, bounds)[:3], ROUTES[("A", "B")], atol=2e-6
    )


def test_encode_day_refuses_durations_too_long_to_store():
    day = build_path_days(make_journeys(), ROUTES, PERIOD_START)[0][0]
    day.journey_duration = np.array([70_000, 600])

    with pytest.raises(OverflowError):
        encode_day(day, (-0.2, 51.4, 0.0, 51.6), ["A", "B"])


def test_export_path_days_writes_an_index_and_a_file_per_day(tmp_path):
    days, _ = build_path_days(make_journeys(), ROUTES, PERIOD_START)

    written = export_path_days(days, PERIOD_START, tmp_path)

    index = json.loads((tmp_path / "paths.json").read_text())
    assert [path.name for path in written] == [
        "paths.json",
        "2024-07-01.bin",
        "2024-07-02.bin",
    ]
    assert index["start"] == "2024-07-01T00:00:00"
    assert index["terminals"] == ["A", "B"]
    assert index["days"][0] == {
        "date": "2024-07-01",
        "file": "2024-07-01.bin",
        "routes": 2,
        "points": 5,
        "journeys": 2,
    }
    # 3 offsets, 2 routes and 2 starts as uint32; 2 durations, 2 routes'
    # start and end stations and 5 points (x and y) as uint16
    size = (tmp_path / "2024-07-01.bin").stat().st_size
    assert size == 7 * 4 + 2 * 2 + 2 * 2 * 2 + 10 * 2
