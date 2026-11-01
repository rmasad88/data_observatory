"""Tests for heartbeat_lib."""

import json

import numpy as np
import pandas as pd
import pytest

from heartbeat_lib import (
    EXPORT_DTYPE,
    Heartbeat,
    build_heartbeat,
    count_events,
    export_heartbeat,
)

DAY = pd.Timestamp("2024-07-01")
BINS_PER_DAY = 24 * 6
NEXT_DAY = DAY + pd.Timedelta(days=1)


def make_journeys(rows):
    """Build journeys from (start_terminal, start, end_terminal, end)."""
    journeys = pd.DataFrame(
        rows, columns=["start_terminal", "start", "end_terminal", "end"]
    )
    for column in ("start", "end"):
        journeys[column] = pd.to_datetime(journeys[column])
    return journeys


@pytest.fixture
def stations():
    return pd.DataFrame({"terminal": ["000001", "000002", "000003"]})


# count_events -----------------------------------------------------------


@pytest.mark.parametrize(
    "time, expected_bin",
    [
        ("2024-07-01 00:00", 0),
        ("2024-07-01 00:09", 0),
        # A time exactly on a boundary belongs to the later bin
        ("2024-07-01 00:10", 1),
        ("2024-07-01 08:05", 48),
        ("2024-07-01 23:59", BINS_PER_DAY - 1),
    ],
)
def test_count_events_bins(time, expected_bin):
    counts = count_events(
        pd.Series(pd.to_datetime([time])),
        pd.Series(["000001"]),
        pd.Index(["000001"]),
        DAY,
        n_bins=BINS_PER_DAY,
    )

    assert counts.sum() == 1
    assert counts[0, expected_bin] == 1


def test_count_events_accumulates_repeats():
    times = pd.Series(pd.to_datetime(["2024-07-01 08:01"] * 3))
    counts = count_events(
        times, pd.Series(["000001"] * 3), pd.Index(["000001"]), DAY, 144
    )

    assert counts[0, 48] == 3


def test_count_events_ignores_events_outside_period():
    times = pd.Series(pd.to_datetime(["2024-06-30 23:59", "2024-07-02 00:00"]))
    counts = count_events(
        times, pd.Series(["000001"] * 2), pd.Index(["000001"]), DAY, 144
    )

    assert counts.sum() == 0


def test_count_events_unknown_terminal_raises():
    with pytest.raises(ValueError, match="999999"):
        count_events(
            pd.Series(pd.to_datetime(["2024-07-01 08:00"])),
            pd.Series(["999999"]),
            pd.Index(["000001"]),
            DAY,
            144,
        )


# build_heartbeat: small samples -----------------------------------------


def test_build_heartbeat_counts_both_ends(stations):
    journeys = make_journeys(
        [("000001", "2024-07-01 08:05", "000002", "2024-07-01 08:25")]
    )
    heartbeat = build_heartbeat(journeys, stations, DAY, NEXT_DAY)
    rows = {t: i for i, t in enumerate(heartbeat.stations["terminal"])}

    assert heartbeat.departures[rows["000001"], 48] == 1
    assert heartbeat.arrivals[rows["000002"], 50] == 1
    assert heartbeat.departures.sum() == heartbeat.arrivals.sum() == 1


def test_build_heartbeat_midnight_crossing(stations):
    journeys = make_journeys(
        [("000001", "2024-07-01 23:55", "000002", "2024-07-02 00:15")]
    )
    two_days_later = DAY + pd.Timedelta(days=2)
    heartbeat = build_heartbeat(journeys, stations, DAY, two_days_later)
    rows = {t: i for i, t in enumerate(heartbeat.stations["terminal"])}

    # Departure in the last bin of day one, arrival in day two
    assert heartbeat.departures[rows["000001"], BINS_PER_DAY - 1] == 1
    assert heartbeat.arrivals[rows["000002"], BINS_PER_DAY + 1] == 1


def test_build_heartbeat_drops_inactive_stations(stations):
    journeys = make_journeys(
        [("000003", "2024-07-01 08:05", "000001", "2024-07-01 08:25")]
    )
    heartbeat = build_heartbeat(journeys, stations, DAY, NEXT_DAY)

    # 000002 has no events; the remaining rows keep the station list order
    assert list(heartbeat.stations["terminal"]) == ["000001", "000003"]
    assert heartbeat.departures.shape == (2, BINS_PER_DAY)
    assert heartbeat.departures[1].sum() == 1


def test_build_heartbeat_bin_starts(stations):
    journeys = make_journeys(
        [("000001", "2024-07-01 08:05", "000002", "2024-07-01 08:25")]
    )
    heartbeat = build_heartbeat(journeys, stations, DAY, NEXT_DAY)

    assert len(heartbeat.bin_starts) == BINS_PER_DAY
    assert heartbeat.bin_starts[0] == DAY
    assert heartbeat.bin_starts[48] == pd.Timestamp("2024-07-01 08:00")


@pytest.mark.parametrize(
    "start, end",
    [
        # end before start
        ("2024-07-02", "2024-07-01"),
        # empty period
        ("2024-07-01", "2024-07-01"),
        # not a whole number of 10-minute bins
        ("2024-07-01 00:00", "2024-07-01 00:15"),
    ],
)
def test_build_heartbeat_invalid_period_raises(stations, start, end):
    journeys = make_journeys([])

    with pytest.raises(ValueError):
        build_heartbeat(journeys, stations, start, end)


# build_heartbeat: real data ---------------------------------------------

FORTNIGHT_START = pd.Timestamp("2024-07-01")
FORTNIGHT_END = pd.Timestamp("2024-07-15")


@pytest.fixture(scope="session")
def heartbeat(cleaned, stations_2024):
    return build_heartbeat(
        cleaned, stations_2024, FORTNIGHT_START, FORTNIGHT_END
    )


def test_fortnight_shape(heartbeat):
    n_stations = len(heartbeat.stations)

    assert heartbeat.departures.shape == (n_stations, 14 * BINS_PER_DAY)
    assert heartbeat.arrivals.shape == heartbeat.departures.shape


def test_fortnight_departures_match_journeys(heartbeat, cleaned):
    starts_inside = cleaned["start"].between(
        FORTNIGHT_START, FORTNIGHT_END, inclusive="left"
    )

    assert heartbeat.departures.sum() == starts_inside.sum()


def test_fortnight_every_station_active(heartbeat):
    events = heartbeat.departures.sum(axis=1) + heartbeat.arrivals.sum(axis=1)

    assert (events > 0).all()


def test_fortnight_morning_tide_drains_waterloo(heartbeat):
    # The commuter story: on weekday mornings (07:00-10:00) Waterloo's docks
    # lose more bikes than they gain
    weekday_morning = (heartbeat.bin_starts.day_of_week < 5) & (
        (heartbeat.bin_starts.hour >= 7) & (heartbeat.bin_starts.hour < 10)
    )
    names = heartbeat.stations["name"]
    waterloo = names.str.startswith("Waterloo Station").to_numpy()
    net = (heartbeat.arrivals - heartbeat.departures)[waterloo][
        :, weekday_morning
    ]

    assert np.sum(net) < 0


# export_heartbeat -------------------------------------------------------


@pytest.fixture
def small_heartbeat():
    """Two stations over three bins, with distinct counts."""
    return Heartbeat(
        stations=pd.DataFrame(
            {
                "terminal": ["000001", "000002"],
                "name": ["Café Street, Somewhere", "Other Road, Elsewhere"],
                "lat": [51.5000012, 51.51],
                "lon": [-0.1234567, -0.12],
                "docks": [20, 30],
                "source": ["2024-08-20 snapshot", "current list"],
            }
        ),
        bin_starts=pd.date_range("2024-07-01", periods=3, freq="10min"),
        departures=np.array([[1, 2, 3], [4, 5, 6]]),
        arrivals=np.array([[7, 8, 9], [10, 11, 12]]),
    )


def read_export(metadata_path, counts_path):
    """Read exported files back the way the browser will."""
    metadata = json.loads(metadata_path.read_text())
    counts = np.fromfile(counts_path, dtype=EXPORT_DTYPE)
    shape = metadata["counts"]["shape"]
    departures, arrivals = counts.reshape(2, *shape)
    return metadata, departures, arrivals


def test_export_round_trip(tmp_path, small_heartbeat):
    metadata, departures, arrivals = read_export(
        *export_heartbeat(small_heartbeat, tmp_path)
    )

    np.testing.assert_array_equal(departures, small_heartbeat.departures)
    np.testing.assert_array_equal(arrivals, small_heartbeat.arrivals)


def test_export_metadata(tmp_path, small_heartbeat):
    metadata_path, counts_path = export_heartbeat(small_heartbeat, tmp_path)
    metadata = json.loads(metadata_path.read_text())

    assert metadata["start"] == "2024-07-01T00:00:00"
    assert metadata["binMinutes"] == 10
    assert metadata["binCount"] == 3
    assert metadata["stationCount"] == 2
    first = metadata["stations"][0]
    assert first["terminal"] == "000001"
    # Non-ASCII names survive, coordinates are [lon, lat] rounded to ~1 m
    assert first["name"] == "Café Street, Somewhere"
    assert first["position"] == [-0.12346, 51.5]
    assert first["source"] == "2024-08-20 snapshot"


def test_export_file_size(tmp_path, small_heartbeat):
    _, counts_path = export_heartbeat(small_heartbeat, tmp_path)

    # 2 blocks x 2 stations x 3 bins x 2 bytes
    assert counts_path.stat().st_size == 2 * 2 * 3 * 2


def test_export_count_too_large_raises(tmp_path, small_heartbeat):
    small_heartbeat.departures[0, 0] = np.iinfo(EXPORT_DTYPE).max + 1

    with pytest.raises(ValueError, match="does not fit"):
        export_heartbeat(small_heartbeat, tmp_path)
    assert not any(tmp_path.iterdir())


def test_export_real_fortnight_round_trip(tmp_path, heartbeat):
    metadata, departures, arrivals = read_export(
        *export_heartbeat(heartbeat, tmp_path)
    )

    assert len(metadata["stations"]) == len(heartbeat.stations)
    np.testing.assert_array_equal(departures, heartbeat.departures)
    np.testing.assert_array_equal(arrivals, heartbeat.arrivals)
