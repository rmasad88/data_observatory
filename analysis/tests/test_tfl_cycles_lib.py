"""Tests for tfl_cycles_lib."""

import gzip
import json
from pathlib import Path

import pandas as pd
import pytest
import requests

from tfl_cycles_lib import (
    JOURNEY_COLUMNS,
    SOURCE_CURRENT,
    SOURCE_SNAPSHOT_2024,
    STATION_COLUMNS,
    download_file,
    get_stations,
    load_journeys,
    load_stations,
)

# Archived 2024 station list committed with the repo
SNAPSHOT_2024 = (
    Path(__file__).resolve().parents[1]
    / "reference"
    / "bikepoint_2024-08-20.json.gz"
)

# Real data is cached in the same folder the notebook uses, so it is only
# downloaded once across test runs and notebook sessions
RAW_DIR = Path(__file__).resolve().parents[1] / "data" / "raw"
JOURNEYS_URL = (
    "https://cycling.data.tfl.gov.uk/usage-stats/"
    "399JourneyDataExtract01Jul2024-14Jul2024.csv"
)
BIKEPOINT_URL = "https://api.tfl.gov.uk/BikePoint"

# .invalid is a reserved domain, so any real request to it would fail
UNREACHABLE_URL = "https://example.invalid/cached.csv"

# A three-row sample in the real column layout, including columns that
# load_journeys should ignore. Row 0 crosses midnight, row 1 has no bike
# number and row 2 is a round trip.
SAMPLE_JOURNEYS_CSV = """\
Number,Start date,Start station number,Start station,End date,\
End station number,End station,Bike number,Bike model,Total duration,\
Total duration (ms)
1,2024-07-01 23:50,001036,A,2024-07-02 00:10,003434,B,62221,CLASSIC,\
20m 0s,1200000
2,2024-07-01 08:00,300047,C,2024-07-01 08:15,001036,A,,PBSC_EBIKE,\
15m 0s,900000
3,2024-07-01 12:00,001007,D,2024-07-01 12:05,001007,D,20895,CLASSIC,\
5m 0s,300000
"""


def bikepoint_station(terminal, docks="20"):
    """Build one station in the BikePoint API's nested layout."""
    props = [{"key": "TerminalName", "value": terminal}]
    if docks is not None:
        props.append({"key": "NbDocks", "value": docks})
    return {
        "commonName": "Test Street, Somewhere",
        "lat": 51.5,
        "lon": -0.1,
        "additionalProperties": props,
    }


# Fixtures ---------------------------------------------------------------


@pytest.fixture(scope="session")
def journeys():
    """The real July 2024 journeys, downloaded once per test session."""
    return load_journeys([download_file(JOURNEYS_URL, RAW_DIR)])


@pytest.fixture(scope="session")
def stations():
    """The real BikePoint stations, downloaded once per test session."""
    path = download_file(BIKEPOINT_URL, RAW_DIR, filename="bikepoint.json")
    return load_stations(path)


@pytest.fixture
def sample_csv(tmp_path):
    """Path to a small journeys CSV in a temporary folder."""
    path = tmp_path / "sample.csv"
    path.write_text(SAMPLE_JOURNEYS_CSV)
    return path


@pytest.fixture
def sample_journeys(sample_csv):
    """The small sample loaded with load_journeys."""
    return load_journeys([sample_csv])


@pytest.fixture
def bikepoint_json(tmp_path):
    """Write a list of stations as a BikePoint JSON file and return it."""

    def write(stations):
        path = tmp_path / "bikepoint.json"
        path.write_text(json.dumps(stations))
        return path

    return write


# download_file ----------------------------------------------------------


def test_download_reuses_cached_file(tmp_path):
    cached = tmp_path / "cached.csv"
    cached.write_text("already here")

    assert download_file(UNREACHABLE_URL, tmp_path) == cached
    assert cached.read_text() == "already here"


def test_download_filename_overrides_url_name(tmp_path):
    custom = tmp_path / "custom.json"
    custom.write_text("{}")

    result = download_file(UNREACHABLE_URL, tmp_path, filename="custom.json")
    assert result == custom


def test_download_default_name_ignores_trailing_slash(tmp_path):
    cached = tmp_path / "cached.csv"
    cached.write_text("already here")

    assert download_file(UNREACHABLE_URL + "/", tmp_path) == cached


def test_download_http_error_leaves_no_file(tmp_path):
    with pytest.raises(requests.HTTPError):
        download_file(
            "https://api.tfl.gov.uk/NoSuchEndpoint", tmp_path, "bad.json"
        )

    assert not (tmp_path / "bad.json").exists()
    assert not (tmp_path / "bad.json.part").exists()


# load_journeys: small sample --------------------------------------------


def test_load_journeys_keeps_leading_zeros(sample_journeys):
    assert sample_journeys.loc[0, "start_terminal"] == "001036"


def test_load_journeys_missing_bike_id_is_na(sample_journeys):
    # The other IDs stay whole numbers rather than becoming floats
    assert sample_journeys["bike_id"].dtype == "Int64"
    assert pd.isna(sample_journeys.loc[1, "bike_id"])
    assert sample_journeys.loc[0, "bike_id"] == 62221


def test_load_journeys_midnight_crossing(sample_journeys):
    assert sample_journeys.loc[0, "start"] == pd.Timestamp("2024-07-01 23:50")
    assert sample_journeys.loc[0, "end"] == pd.Timestamp("2024-07-02 00:10")


def test_load_journeys_concatenates_files(sample_csv):
    assert len(load_journeys([sample_csv, sample_csv])) == 6


def test_load_journeys_missing_column_raises(tmp_path):
    # Simulates an older TfL layout with a renamed column
    old_layout = tmp_path / "old_layout.csv"
    old_layout.write_text(
        SAMPLE_JOURNEYS_CSV.replace("Bike model", "Bike type")
    )

    with pytest.raises(ValueError):
        load_journeys([old_layout])


def test_load_journeys_empty_list_raises():
    with pytest.raises(ValueError, match="at least one journey file"):
        load_journeys([])


# load_journeys: real data -----------------------------------------------


def test_journeys_columns_match_renamed_set(journeys):
    assert list(journeys.columns) == list(JOURNEY_COLUMNS.values())


def test_journeys_station_numbers_keep_leading_zeros(journeys):
    assert journeys["start_terminal"].str.startswith("0").any()
    assert journeys["start_terminal"].str.len().min() == 6


def test_journeys_times_are_datetimes(journeys):
    assert pd.api.types.is_datetime64_any_dtype(journeys["start"])
    assert pd.api.types.is_datetime64_any_dtype(journeys["end"])


def test_journeys_rental_ids_unique(journeys):
    assert journeys["rental_id"].is_unique


# load_stations: small samples -------------------------------------------


def test_load_stations_unpacks_nested_fields(bikepoint_json):
    one = load_stations(bikepoint_json([bikepoint_station("001023")]))

    assert one.loc[0, "terminal"] == "001023"
    assert one.loc[0, "docks"] == 20
    assert (one.loc[0, "lat"], one.loc[0, "lon"]) == (51.5, -0.1)


def test_load_stations_missing_docks_raises(bikepoint_json):
    path = bikepoint_json([bikepoint_station("001023", docks=None)])

    with pytest.raises(KeyError):
        load_stations(path)


def test_load_stations_empty_keeps_columns(bikepoint_json):
    empty = load_stations(bikepoint_json([]))

    assert empty.empty
    assert list(empty.columns) == STATION_COLUMNS


def test_load_stations_reads_gzip(tmp_path, bikepoint_json):
    plain = bikepoint_json([bikepoint_station("001023")])
    compressed = tmp_path / "bikepoint.json.gz"
    compressed.write_bytes(gzip.compress(plain.read_bytes()))

    pd.testing.assert_frame_equal(
        load_stations(compressed), load_stations(plain)
    )


def test_snapshot_2024_has_2024_stations():
    snapshot = load_stations(SNAPSHOT_2024).set_index("terminal")

    assert len(snapshot) == 794
    # A station that has since closed
    assert snapshot.loc["022163", "name"].startswith("Southwark Station 2")
    # A terminal number TfL later reused for a station 12 km away
    assert snapshot.loc["001058", "name"].startswith("Edgware Road Station")


# load_stations: real data -----------------------------------------------


def test_stations_columns(stations):
    assert list(stations.columns) == STATION_COLUMNS


def test_stations_terminals_unique_six_chars(stations):
    assert stations["terminal"].is_unique
    assert (stations["terminal"].str.len() == 6).all()


def test_stations_inside_greater_london(stations):
    assert stations["lat"].between(51.3, 51.7).all()
    assert stations["lon"].between(-0.5, 0.3).all()


def test_stations_have_docks(stations):
    assert (stations["docks"] > 0).all()


def test_most_journeys_start_at_known_station(journeys, stations):
    # Confirms the terminal numbers line up for the join; a few journeys
    # use stations that have since moved or closed
    known = journeys["start_terminal"].isin(stations["terminal"])
    assert known.mean() > 0.95


# get_stations -----------------------------------------------------------

# A typo in TfL's own journey file ("St. Lke's"), not a station mismatch
KNOWN_NAME_TYPOS = {"000964"}


@pytest.fixture(scope="session")
def stations_2024():
    return get_stations("2024", RAW_DIR)


@pytest.fixture(scope="session")
def journey_station_names():
    """Each start terminal and the station name the journey file gives."""
    path = download_file(JOURNEYS_URL, RAW_DIR)
    names = pd.read_csv(
        path, usecols=["Start station number", "Start station"], dtype=str
    )
    return names.drop_duplicates().set_axis(["terminal", "name"], axis=1)


def test_get_stations_invalid_source_raises(tmp_path):
    # Raises before trying to download anything into tmp_path
    with pytest.raises(ValueError, match="2024"):
        get_stations("2025", tmp_path)
    assert not any(tmp_path.iterdir())


def test_get_stations_current_is_todays_list(stations):
    current = get_stations("current", RAW_DIR)

    assert (current["source"] == SOURCE_CURRENT).all()
    pd.testing.assert_frame_equal(current.drop(columns="source"), stations)


def test_get_stations_2024_prefers_snapshot(stations_2024):
    by_terminal = stations_2024.set_index("terminal")

    # Reused terminal keeps its 2024 location
    assert by_terminal.loc["001058", "name"].startswith("Edgware Road")
    assert by_terminal.loc["001058", "source"] == SOURCE_SNAPSHOT_2024


def test_get_stations_2024_fills_gaps_from_current(stations_2024):
    by_terminal = stations_2024.set_index("terminal")

    # Missing from the August 2024 snapshot but used in July 2024
    assert by_terminal.loc["001203", "name"].startswith("Eastbourne Mews")
    assert by_terminal.loc["001203", "source"] == SOURCE_CURRENT


def test_get_stations_2024_terminals_unique(stations_2024):
    assert stations_2024["terminal"].is_unique
    assert list(stations_2024.columns) == STATION_COLUMNS + ["source"]


def test_get_stations_2024_names_match_journey_file(
    stations_2024, journey_station_names
):
    # The journey file names each station as it was in July 2024, so a
    # mismatch means the list has the wrong station for that terminal
    pairs = journey_station_names.merge(
        stations_2024, on="terminal", suffixes=("_journey", "_list")
    )
    journey_names = pairs["name_journey"].str.strip()
    differs = journey_names != pairs["name_list"].str.strip()

    assert set(pairs.loc[differs, "terminal"]) == KNOWN_NAME_TYPOS
