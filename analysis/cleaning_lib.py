"""Cleaning rules for TfL cycle hire journeys loaded by loading_lib."""

import pandas as pd

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
