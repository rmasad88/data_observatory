"""Tests for routing_lib, on small made-up street networks."""

import math

import networkx as nx
import pandas as pd
import pytest
from shapely.geometry import LineString

from routing_lib import (
    COST,
    DEDICATED_MULTIPLIER,
    DISMOUNT_MULTIPLIER,
    METERS_PER_DEGREE_LATITUDE,
    QUIET_MULTIPLIER,
    edge_multiplier,
    route_coordinates,
    route_length_meters,
    route_pairs,
    simplify_route,
    snap_stations,
    station_route,
    weight_network,
)


@pytest.mark.parametrize(
    "edge, expected",
    [
        ({"highway": "residential"}, QUIET_MULTIPLIER),
        ({"highway": "cycleway"}, DEDICATED_MULTIPLIER),
        ({"highway": "residential", "bicycle": "designated"}, 0.8),
        ({"highway": "primary", "cycleway:left": "track"}, 0.8),
        ({"highway": "tertiary"}, 1.2),
        ({"highway": "secondary"}, 1.4),
        ({"highway": "primary"}, 1.6),
        ({"highway": "trunk"}, 2.0),
        # Slip roads count as the road they join
        ({"highway": "primary_link"}, 1.6),
        # A painted lane or shared bus lane halves a busy road's penalty
        ({"highway": "primary", "cycleway:right": "lane"}, 1.3),
        ({"highway": "trunk", "cycleway:both": "share_busway"}, 1.5),
        ({"highway": "residential", "cycleway": "lane"}, 1.0),
        ({"highway": "residential", "bicycle": "dismount"}, 2.0),
        ({"highway": "pedestrian"}, DISMOUNT_MULTIPLIER),
        ({"highway": "pedestrian", "bicycle": "yes"}, QUIET_MULTIPLIER),
        # A merged edge takes its busiest part's penalty
        ({"highway": ["residential", "secondary"]}, 1.4),
        # Missing tags read from GraphML can be NaN
        ({"highway": "residential", "bicycle": float("nan")}, 1.0),
    ],
)
def test_edge_multiplier(edge, expected):
    assert edge_multiplier(edge) == pytest.approx(expected)


def make_network(cycleway_length):
    """Two nodes joined by a 1 km primary road, plus a detour via a third
    node on cycleways of the given length each way, in both directions."""
    graph = nx.MultiDiGraph(crs="epsg:4326")
    graph.add_node(1, x=-0.10, y=51.50)
    graph.add_node(2, x=-0.09, y=51.50)
    graph.add_node(3, x=-0.095, y=51.505)
    streets = [
        (1, 2, 1000, "primary"),
        (1, 3, cycleway_length, "cycleway"),
        (3, 2, cycleway_length, "cycleway"),
    ]
    for u, v, length, highway in streets:
        graph.add_edge(u, v, length=length, highway=highway)
        graph.add_edge(v, u, length=length, highway=highway)
    return weight_network(graph)


def test_weight_network_sets_cost():
    graph = make_network(600)

    assert graph[1][2][0][COST] == pytest.approx(1000 * 1.6)
    assert graph[1][3][0][COST] == pytest.approx(600 * 0.8)


def test_route_prefers_a_cycleway_detour_when_short():
    # Cycleways 1,200 m in all cost 960; the primary road costs 1,600
    routes = route_pairs(make_network(600), [(1, 2)])

    assert routes[(1, 2)] == [1, 3, 2]


def test_route_takes_the_main_road_when_the_detour_is_long():
    # Cycleways 3,000 m in all cost 2,400, more than the primary's 1,600
    routes = route_pairs(make_network(1500), [(1, 2), (2, 1)])

    assert routes[(1, 2)] == [1, 2]
    assert routes[(2, 1)] == [2, 1]


def test_route_pairs_leaves_out_unreachable_pairs():
    graph = make_network(600)
    graph.add_node(4, x=0.0, y=51.0)

    routes = route_pairs(graph, [(1, 4), (1, 2)])

    assert (1, 4) not in routes
    assert (1, 2) in routes


def test_snap_stations_finds_the_nearest_node():
    graph = make_network(600)
    stations = pd.DataFrame(
        {"lon": [-0.0901, -0.0951], "lat": [51.5001, 51.5049]}
    )

    assert list(snap_stations(graph, stations)) == [2, 3]


def test_snap_stations_ignores_streets_cut_off_from_the_rest():
    graph = make_network(600)
    # A one-way stub: reachable from node 2 but with no way back
    graph.add_node(5, x=-0.0850, y=51.50)
    graph.add_edge(2, 5, length=350, highway="residential", **{COST: 350})
    stations = pd.DataFrame({"lon": [-0.0851], "lat": [51.50]})

    assert list(snap_stations(graph, stations)) == [2]


def test_route_coordinates_follow_street_shapes():
    graph = make_network(600)
    # A curved primary road, stored from node 2's end to node 1's
    bend = LineString([(-0.09, 51.50), (-0.095, 51.499), (-0.10, 51.50)])
    graph[1][2][0]["geometry"] = bend

    points = route_coordinates(graph, [1, 2])

    assert points == [(-0.10, 51.50), (-0.095, 51.499), (-0.09, 51.50)]


def test_route_coordinates_use_node_positions_for_straight_streets():
    assert route_coordinates(make_network(600), [1, 3, 2]) == [
        (-0.10, 51.50),
        (-0.095, 51.505),
        (-0.09, 51.50),
    ]


def test_station_route_runs_from_dock_to_dock():
    graph = make_network(600)
    start, end = (-0.1002, 51.4998), (-0.0898, 51.5002)

    route = station_route(graph, [1, 3, 2], start, end, tolerance_meters=0)

    expected = [start, (-0.10, 51.50), (-0.095, 51.505), (-0.09, 51.50), end]
    assert route == [pytest.approx(point) for point in expected]
    # The docks themselves are exact
    assert route[0] == start and route[-1] == end


def test_station_route_is_straight_between_stations_on_one_junction():
    start, end = (-0.1002, 51.4998), (-0.0998, 51.5002)

    assert station_route(make_network(600), [1], start, end, 1) == [start, end]


def test_simplify_route_drops_small_wiggles_but_keeps_corners():
    # East 1 km with a 2 m wiggle, then north 1 km: a right angle
    step = 1 / METERS_PER_DEGREE_LATITUDE
    x_step = step / math.cos(math.radians(51.5))
    points = [
        (0.0, 51.5),
        (500 * x_step, 51.5 + 2 * step),
        (1000 * x_step, 51.5),
        (1000 * x_step, 51.5 + 1000 * step),
    ]

    simplified = simplify_route(points, tolerance_meters=5)

    expected = [points[0], points[2], points[3]]
    assert simplified == [pytest.approx(point) for point in expected]


def test_simplify_route_keeps_short_routes():
    points = [(0.0, 51.5), (0.01, 51.5)]

    assert simplify_route(points, 5) == points


def test_route_length_meters():
    # A tenth of a degree of latitude is about 11.1 km
    assert route_length_meters([(0.0, 51.5), (0.0, 51.6)]) == pytest.approx(
        11_132, rel=1e-3
    )
