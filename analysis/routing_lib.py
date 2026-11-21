"""Estimate the route a rider took between two docking stations.

TfL's journey data records only where and when each hire started and ended,
so the route is estimated: the cheapest path on OpenStreetMap's cycleable
street network, where each street costs its length times a multiplier that
favours cycle routes and quiet streets over busy roads. The multipliers are
assumptions, not measurements.
"""

import math
from pathlib import Path

import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from shapely.geometry import LineString

# Street cost multipliers (cost = length x multiplier). A rider will go up to
# 25% further to avoid a primary road, for example.
DEDICATED_MULTIPLIER = 0.8
QUIET_MULTIPLIER = 1.0
DISMOUNT_MULTIPLIER = 2.0
BUSY_ROAD_MULTIPLIERS = {
    "tertiary": 1.2,
    "secondary": 1.4,
    "primary": 1.6,
    "trunk": 2.0,
}

# Tags meaning a street has its own space for cycling
DEDICATED_CYCLEWAY_VALUES = {"track", "separate"}
# Tags meaning cyclists share the road but have some provision, which halves
# a busy road's penalty
PAINTED_CYCLEWAY_VALUES = {
    "lane",
    "share_busway",
    "shared_lane",
    "shared",
    "opposite_lane",
    "opposite_share_busway",
}
CYCLEWAY_TAGS = [
    "cycleway",
    "cycleway:left",
    "cycleway:right",
    "cycleway:both",
]
# Where riders are expected to walk unless cycling is explicitly allowed
WALKING_HIGHWAYS = {"pedestrian", "footway", "steps"}
CYCLING_ALLOWED = {"yes", "designated", "permissive"}

# OSM tags kept on the downloaded network, beyond osmnx's defaults
EXTRA_WAY_TAGS = CYCLEWAY_TAGS + ["bicycle", "segregated"]
# Margin around the stations when downloading the network, in degrees
# (about 1 km), so routes near the edge can go round obstacles
NETWORK_PADDING_DEGREES = 0.015

# Edge attribute holding each street's routing cost
COST = "cost"
METERS_PER_DEGREE_LATITUDE = 111_320


def load_bike_network(
    stations: pd.DataFrame, cache_path: Path
) -> nx.MultiDiGraph:
    """Download the cycleable street network around the stations, once.

    Parameters
    ----------
    stations : pandas.DataFrame
        Stations with ``lat`` and ``lon`` columns.
    cache_path : pathlib.Path
        GraphML file to read the network from, or to save it to after
        downloading.

    Returns
    -------
    networkx.MultiDiGraph
        osmnx's "bike" network, with cycling tags on each edge.
    """
    if cache_path.exists():
        return ox.load_graphml(cache_path)

    # Keep osmnx's download cache with the other downloads, out of git
    ox.settings.cache_folder = cache_path.parent / "http_cache"
    ox.settings.useful_tags_way = list(
        dict.fromkeys(list(ox.settings.useful_tags_way) + EXTRA_WAY_TAGS)
    )
    pad = NETWORK_PADDING_DEGREES
    bbox = (
        stations["lon"].min() - pad,
        stations["lat"].min() - pad,
        stations["lon"].max() + pad,
        stations["lat"].max() + pad,
    )
    graph = ox.graph_from_bbox(bbox, network_type="bike", simplify=True)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(graph, cache_path)
    return graph


def _tag_values(edge: dict, tag: str) -> set:
    """An edge's values for a tag, as a set.

    Merged edges can hold a list of values, one per original OSM way.
    """
    value = edge.get(tag)
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return set()
    if isinstance(value, list):
        return {str(v) for v in value}
    return {str(value)}


def edge_multiplier(edge: dict) -> float:
    """The cost multiplier for one street, from its OSM tags.

    Parameters
    ----------
    edge : dict
        The edge's attributes, e.g. ``{"highway": "primary",
        "cycleway:left": "lane"}``.

    Returns
    -------
    float
        Below 1 for dedicated cycle routes, 1 for quiet streets, above 1 for
        busy roads and places riders must walk.
    """
    highway = _tag_values(edge, "highway")
    bicycle = _tag_values(edge, "bicycle")
    cycleway = set().union(*(_tag_values(edge, tag) for tag in CYCLEWAY_TAGS))

    if "dismount" in bicycle:
        return DISMOUNT_MULTIPLIER
    if (
        "cycleway" in highway
        or "designated" in bicycle
        or cycleway & DEDICATED_CYCLEWAY_VALUES
    ):
        return DEDICATED_MULTIPLIER
    if highway & WALKING_HIGHWAYS and not bicycle & CYCLING_ALLOWED:
        return DISMOUNT_MULTIPLIER

    # A merged edge takes its busiest part's penalty. "_link" slip roads
    # count as the road they join.
    busy = [
        BUSY_ROAD_MULTIPLIERS.get(
            value.removesuffix("_link"), QUIET_MULTIPLIER
        )
        for value in highway
    ]
    multiplier = max(busy, default=QUIET_MULTIPLIER)
    if multiplier > QUIET_MULTIPLIER and cycleway & PAINTED_CYCLEWAY_VALUES:
        multiplier = QUIET_MULTIPLIER + (multiplier - QUIET_MULTIPLIER) / 2
    return multiplier


def weight_network(graph: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Set each street's routing cost: its length times its multiplier.

    The graph is changed in place and also returned.
    """
    for _, _, edge in graph.edges(data=True):
        edge[COST] = float(edge["length"]) * edge_multiplier(edge)
    return graph


def snap_stations(
    graph: nx.MultiDiGraph, stations: pd.DataFrame
) -> np.ndarray:
    """The network node nearest each station, in station order.

    Only nodes in the network's largest strongly connected part are used,
    so every station can reach, and be reached from, every other. (A few
    streets cut off by one-way rules would otherwise strand a station.)
    """
    connected = ox.truncate.largest_component(graph, strongly=True)
    return np.asarray(
        ox.distance.nearest_nodes(
            connected, X=stations["lon"], Y=stations["lat"]
        )
    )


def route_pairs(
    graph: nx.MultiDiGraph, pairs: list[tuple[int, int]]
) -> dict[tuple[int, int], list[int]]:
    """The cheapest path between each pair of nodes, by routing cost.

    One shortest-path search runs per distinct start node and serves every
    pair starting there.

    Parameters
    ----------
    graph : networkx.MultiDiGraph
        A network with routing costs from ``weight_network``.
    pairs : list of (int, int)
        Start and end node ids.

    Returns
    -------
    dict
        Each reachable pair's path as a list of node ids, start to end.
        Pairs with no path are left out.
    """
    nodes = list(graph.nodes)
    index = {node: i for i, node in enumerate(nodes)}
    matrix = _cost_matrix(graph, index)

    ends_by_start: dict[int, list[int]] = {}
    for start, end in pairs:
        ends_by_start.setdefault(start, []).append(end)

    routes = {}
    for start, ends in ends_by_start.items():
        _, predecessors = dijkstra(
            matrix, indices=index[start], return_predecessors=True
        )
        for end in ends:
            path = _follow_predecessors(predecessors, index[start], index[end])
            if path is not None:
                routes[(start, end)] = [nodes[i] for i in path]
    return routes


def _cost_matrix(graph: nx.MultiDiGraph, index: dict) -> csr_matrix:
    """A sparse matrix of the cheapest street between each pair of nodes."""
    cheapest: dict[tuple[int, int], float] = {}
    for u, v, edge in graph.edges(data=True):
        key = (index[u], index[v])
        cheapest[key] = min(edge[COST], cheapest.get(key, math.inf))
    rows, cols = zip(*cheapest) if cheapest else ((), ())
    size = len(index)
    return csr_matrix(
        (list(cheapest.values()), (rows, cols)), shape=(size, size)
    )


def _follow_predecessors(
    predecessors: np.ndarray, start: int, end: int
) -> list[int] | None:
    """The path from ``start`` to ``end`` from a shortest-path search."""
    path = [end]
    while path[-1] != start:
        previous = predecessors[path[-1]]
        # scipy marks nodes it couldn't reach with a negative number
        if previous < 0:
            return None
        path.append(previous)
    return path[::-1]


def route_coordinates(
    graph: nx.MultiDiGraph, path: list[int]
) -> list[tuple[float, float]]:
    """The (lon, lat) points along a path, following each street's shape.

    Between two nodes the cheapest street is used, matching
    ``route_pairs``. Curved streets carry their shape as a ``geometry``.
    """
    points = [_node_point(graph, path[0])]
    for u, v in zip(path, path[1:]):
        edge = min(graph[u][v].values(), key=lambda data: data[COST])
        geometry = edge.get("geometry")
        if geometry is None:
            points.append(_node_point(graph, v))
            continue
        coords = list(geometry.coords)
        # A street's shape may be stored in either direction
        if _distance_squared(coords[0], points[-1]) > _distance_squared(
            coords[-1], points[-1]
        ):
            coords.reverse()
        points.extend(coords[1:])
    return points


def _node_point(graph: nx.MultiDiGraph, node: int) -> tuple[float, float]:
    data = graph.nodes[node]
    return (float(data["x"]), float(data["y"]))


def _distance_squared(a, b) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def simplify_route(
    points: list[tuple[float, float]], tolerance_meters: float
) -> list[tuple[float, float]]:
    """Drop points that change the route's shape by less than a tolerance.

    Uses the Douglas-Peucker algorithm in local metres, so the tolerance is
    the same in every direction.

    Parameters
    ----------
    points : list of (float, float)
        (lon, lat) points along the route.
    tolerance_meters : float
        The largest allowed distance between the simplified and original
        route.

    Returns
    -------
    list of (float, float)
        A subset of the points, always keeping the first and last.
    """
    if len(points) <= 2:
        return list(points)
    latitude = points[0][1]
    x_scale = METERS_PER_DEGREE_LATITUDE * math.cos(math.radians(latitude))
    y_scale = METERS_PER_DEGREE_LATITUDE
    line = LineString([(lon * x_scale, lat * y_scale) for lon, lat in points])
    simplified = line.simplify(tolerance_meters, preserve_topology=False)
    middle = [(x / x_scale, y / y_scale) for x, y in simplified.coords[1:-1]]
    # The ends are returned exactly, so a route always meets its stations
    return [points[0], *middle, points[-1]]


def station_route(
    graph: nx.MultiDiGraph,
    path: list[int],
    start: tuple[float, float],
    end: tuple[float, float],
    tolerance_meters: float,
) -> list[tuple[float, float]]:
    """A ride's drawn route: from one station's dock along the streets to
    another's, simplified.

    Parameters
    ----------
    graph : networkx.MultiDiGraph
        A network with routing costs from ``weight_network``.
    path : list of int
        Node ids from ``route_pairs``. A single node (two stations snapped to
        the same junction) gives a straight line between the docks.
    start, end : (float, float)
        The stations' (lon, lat) positions.
    tolerance_meters : float
        Passed to ``simplify_route``.
    """
    streets = route_coordinates(graph, path) if len(path) > 1 else []
    return simplify_route([start, *streets, end], tolerance_meters)


def route_length_meters(points: list[tuple[float, float]]) -> float:
    """A route's length, measuring each step in local metres."""
    total = 0.0
    for (lon1, lat1), (lon2, lat2) in zip(points, points[1:]):
        x_scale = METERS_PER_DEGREE_LATITUDE * math.cos(
            math.radians((lat1 + lat2) / 2)
        )
        dx = (lon2 - lon1) * x_scale
        dy = (lat2 - lat1) * METERS_PER_DEGREE_LATITUDE
        total += math.hypot(dx, dy)
    return total
