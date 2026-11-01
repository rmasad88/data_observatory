"""Tests for cleaning_lib."""

import pandas as pd
import pytest

from cleaning_lib import (
    LONG_HIRE_MAX_MS,
    clean_journeys,
    drop_false_starts,
    drop_long_hires,
    drop_unknown_stations,
    map_relocated_terminals,
)


def make_journeys(rows):
    """Build journeys from (start_terminal, end_terminal, duration_ms)."""
    return pd.DataFrame(
        rows, columns=["start_terminal", "end_terminal", "duration_ms"]
    )


def test_map_relocated_strips_suffix():
    journeys = make_journeys([("001020444", "003429444", 600_000)])
    mapped = map_relocated_terminals(journeys)

    assert mapped.loc[0, "start_terminal"] == "001020"
    assert mapped.loc[0, "end_terminal"] == "003429"


def test_map_relocated_keeps_six_digit_terminal_ending_444():
    # 003444 is a real station, not a relocation
    journeys = make_journeys([("003444", "001020", 600_000)])

    assert map_relocated_terminals(journeys).loc[0, "start_terminal"] == (
        "003444"
    )


def test_map_relocated_leaves_input_unchanged():
    journeys = make_journeys([("001020444", "001020", 600_000)])
    map_relocated_terminals(journeys)

    assert journeys.loc[0, "start_terminal"] == "001020444"


def test_drop_unknown_stations():
    stations = pd.DataFrame({"terminal": ["001020", "003429"]})
    journeys = make_journeys(
        [
            ("001020", "003429", 600_000),
            ("022168", "003429", 600_000),
            ("001020", "010626", 600_000),
        ]
    )
    kept = drop_unknown_stations(journeys, stations)

    assert len(kept) == 1
    assert list(kept.index) == [0]
    assert kept.loc[0, "start_terminal"] == "001020"


@pytest.mark.parametrize(
    "start, end, duration_ms, dropped",
    [
        ("001020", "001020", 30_000, True),
        ("001020", "001020", 59_999, True),
        ("001020", "001020", 60_000, False),
        ("001020", "001020", 1_200_000, False),
        # A short hire to a different station is a real (if brief) journey
        ("001020", "003429", 30_000, False),
    ],
)
def test_drop_false_starts(start, end, duration_ms, dropped):
    journeys = make_journeys([(start, end, duration_ms)])

    assert drop_false_starts(journeys).empty == dropped


@pytest.mark.parametrize(
    "duration_ms, dropped",
    [
        (LONG_HIRE_MAX_MS - 1, False),
        (LONG_HIRE_MAX_MS, False),
        (LONG_HIRE_MAX_MS + 1, True),
        # A lost bike returned weeks later
        (18 * 24 * 60 * 60 * 1000, True),
    ],
)
def test_drop_long_hires(duration_ms, dropped):
    journeys = make_journeys([("001020", "003429", duration_ms)])

    assert drop_long_hires(journeys).empty == dropped


@pytest.fixture(scope="session")
def cleaned(journeys, stations_2024):
    return clean_journeys(journeys, stations_2024)


def test_clean_journeys_keeps_relocated_station_journeys(cleaned):
    terminals = pd.concat([cleaned["start_terminal"], cleaned["end_terminal"]])

    # No old nine-digit terminals remain, and the relocated station
    # keeps its journeys under its current number
    assert (terminals.str.len() == 6).all()
    assert (terminals == "001020").sum() > 1_000


def test_clean_journeys_all_stations_known(cleaned, stations_2024):
    known = stations_2024["terminal"]

    assert cleaned["start_terminal"].isin(known).all()
    assert cleaned["end_terminal"].isin(known).all()


def test_clean_journeys_removes_under_two_percent(journeys, cleaned):
    # Workshops, false starts and long hires are a small fraction of hires
    removed = 1 - len(cleaned) / len(journeys)

    assert 0 < removed < 0.02


def test_clean_journeys_drops_long_hires(cleaned):
    assert cleaned["duration_ms"].max() <= LONG_HIRE_MAX_MS
