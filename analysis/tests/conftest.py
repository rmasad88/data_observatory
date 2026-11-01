"""Fixtures shared by the analysis test files.

pytest loads this file automatically, so any test can use these fixtures
by naming them as arguments.
"""

from pathlib import Path

import pytest

from loading_lib import download_file, get_stations, load_journeys

# Real data is cached in the same folder the notebook uses, so it is only
# downloaded once across test runs and notebook sessions
RAW_DIR = Path(__file__).resolve().parents[1] / "data" / "raw"
JOURNEYS_URL = (
    "https://cycling.data.tfl.gov.uk/usage-stats/"
    "399JourneyDataExtract01Jul2024-14Jul2024.csv"
)


@pytest.fixture(scope="session")
def raw_dir():
    """Folder where real TfL data is downloaded and cached."""
    return RAW_DIR


@pytest.fixture(scope="session")
def journeys_path():
    """The real July 2024 journeys CSV, downloaded once."""
    return download_file(JOURNEYS_URL, RAW_DIR)


@pytest.fixture(scope="session")
def journeys(journeys_path):
    """The real July 2024 journeys, loaded once per test session."""
    return load_journeys([journeys_path])


@pytest.fixture(scope="session")
def stations_2024():
    """The 2024 station list, built once per test session."""
    return get_stations("2024", RAW_DIR)
