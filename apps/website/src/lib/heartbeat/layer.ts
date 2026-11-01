// Turns heartbeat counts into what is drawn for each station: how big its dot
// is and what colour. Kept free of React so every rule can be unit-tested.

import { ScatterplotLayer } from '@deck.gl/layers';
import type { CircleLayerSpecification } from 'maplibre-gl';

import { countIndex, type HeartbeatData, type HeartbeatStation } from './data';

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

// Departures and arrivals per 10-minute bin, after smoothing
export type StationActivity = {
    departures: number;
    arrivals: number;
};

// Diverging colours for net flow, checked for colour-blind safety on a dark map
// with the dataviz palette validator: red = losing bikes, blue = gaining.
export const COLOR_LOSING: RGB = [230, 103, 103];
export const COLOR_GAINING: RGB = [57, 135, 229];
export const COLOR_BALANCED: RGB = [138, 138, 133];
// A thin ring in the map's background colour keeps overlapping dots distinct
const OUTLINE_COLOR: RGBA = [14, 14, 14, 200];

// Activity is a Gaussian-weighted average of nearby bins with this standard
// deviation, so dots follow the hourly trend rather than 10-minute noise. Each
// bin's weight fades gradually with distance, so no bin enters or leaves the
// average suddenly and dots don't step at bin boundaries.
export const SMOOTHING_SIGMA_MINUTES = 30;
// Bins further away than this many standard deviations are left out: their
// weight is too small to see
const SMOOTHING_CUTOFF_SIGMAS = 4;

// Dot area grows with activity, so the radius grows with its square root.
// Metres, so dots scale with the map's zoom and line up across wall tiles.
export const RADIUS_BASE_METERS = 30;
export const RADIUS_PER_SQRT_JOURNEY_METERS = 75;
// Smallest dot, in pixels, so every station stays visible when zoomed out
export const RADIUS_MIN_PIXELS = 1.5;

// Below this many journeys per bin a station fades towards the map
export const ACTIVITY_FOR_FULL_OPACITY = 6;
const MIN_ALPHA = 60;
const MAX_ALPHA = 255;

// Added to the total when working out net share, so one journey at a quiet
// station doesn't turn it fully red or blue
const NET_FLOW_DAMPING = 1;

// Fractional bin position for a time in minutes since the data's start,
// wrapped to the data's period. Shifted by half a bin so each count is shown at
// the middle of the 10 minutes it describes.
export function binPositionAt(data: HeartbeatData, minutes: number) {
    const position = minutes / data.binMinutes - 0.5;
    return ((position % data.binCount) + data.binCount) % data.binCount;
}

// A station's smoothed activity at a (fractional) bin position, where position
// n is the middle of bin n: the average of nearby bins, each weighted by
// exp(-d² / 2σ²) for its distance d. After the last bin it continues into the
// first, so the fortnight loops seamlessly.
export function activityAtPosition(
    data: HeartbeatData,
    station: number,
    binPosition: number,
    sigmaMinutes = SMOOTHING_SIGMA_MINUTES
): StationActivity {
    return weightedActivity(data, station, smoothingWeights(data, binPosition, sigmaMinutes));
}

// Every station's smoothed activity at a bin position, in station order. The
// same as `activityAtPosition` for each station, but the weights depend only on
// the position, so they are worked out once for all stations.
export function activitiesAtPosition(
    data: HeartbeatData,
    binPosition: number,
    sigmaMinutes = SMOOTHING_SIGMA_MINUTES
): StationActivity[] {
    const weights = smoothingWeights(data, binPosition, sigmaMinutes);
    return data.stations.map((_, station) => weightedActivity(data, station, weights));
}

// The bins near a position (wrapped to the period) and their Gaussian weights,
// scaled to add up to 1
type SmoothingWeights = { bins: number[]; weights: number[] };

function smoothingWeights(
    data: HeartbeatData,
    binPosition: number,
    sigmaMinutes: number
): SmoothingWeights {
    const sigmaBins = sigmaMinutes / data.binMinutes;
    const reach = Math.ceil(SMOOTHING_CUTOFF_SIGMAS * sigmaBins);
    const nearest = Math.round(binPosition);
    const bins: number[] = [];
    const weights: number[] = [];
    for (let bin = nearest - reach; bin <= nearest + reach; bin++) {
        const distance = bin - binPosition;
        bins.push(((bin % data.binCount) + data.binCount) % data.binCount);
        weights.push(Math.exp(-(distance * distance) / (2 * sigmaBins * sigmaBins)));
    }
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    return { bins, weights: weights.map((weight) => weight / totalWeight) };
}

function weightedActivity(
    data: HeartbeatData,
    station: number,
    { bins, weights }: SmoothingWeights
): StationActivity {
    let departures = 0;
    let arrivals = 0;
    for (let i = 0; i < bins.length; i++) {
        const index = countIndex(data, station, bins[i]);
        departures += weights[i] * data.departures[index];
        arrivals += weights[i] * data.arrivals[index];
    }
    return { departures, arrivals };
}

export function stationRadius({ departures, arrivals }: StationActivity) {
    return RADIUS_BASE_METERS + RADIUS_PER_SQRT_JOURNEY_METERS * Math.sqrt(departures + arrivals);
}

export function stationColor({ departures, arrivals }: StationActivity): RGBA {
    const total = departures + arrivals;
    // Net share in [-1, 1]: negative = more bikes leaving than arriving
    const net = (arrivals - departures) / (total + NET_FLOW_DAMPING);
    const pole = net < 0 ? COLOR_LOSING : COLOR_GAINING;
    const strength = Math.min(1, Math.abs(net));
    const alpha =
        MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * Math.min(1, total / ACTIVITY_FOR_FULL_OPACITY);

    return [
        Math.round(lerp(COLOR_BALANCED[0], pole[0], strength)),
        Math.round(lerp(COLOR_BALANCED[1], pole[1], strength)),
        Math.round(lerp(COLOR_BALANCED[2], pole[2], strength)),
        Math.round(alpha)
    ];
}

// The deck.gl layer drawing every station at a (fractional) bin position
export function createStationLayer(data: HeartbeatData, binPosition: number) {
    // Work out each station's activity once, rather than in both accessors
    const activities = activitiesAtPosition(data, binPosition);

    return new ScatterplotLayer<HeartbeatStation>({
        id: 'stations',
        data: data.stations,
        getPosition: (station) => station.position,
        getRadius: (_, { index }) => stationRadius(activities[index]),
        getFillColor: (_, { index }) => stationColor(activities[index]),
        radiusUnits: 'meters',
        // Keep every station visible as at least a small dot when zoomed out
        radiusMinPixels: RADIUS_MIN_PIXELS,
        stroked: true,
        getLineColor: OUTLINE_COLOR,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        // Recalculate sizes and colours only when the position changes
        updateTriggers: {
            getRadius: binPosition,
            getFillColor: binPosition
        }
    });
}

// --- Iframe-safe fallback: the same picture drawn with MapLibre's circle layer ---

// A station's size and colour for the fallback, set on its circle as MapLibre
// "feature state" so it can change every frame without re-sending any geometry
export type StationStyle = {
    // Radius in metres, as on the deck.gl path
    radius: number;
    // CSS colour, e.g. "rgba(230, 103, 103, 0.80)"
    color: string;
};

// The stations as GeoJSON points, added to the map once. Each point's id is its
// station index, which is how `stationStyles` entries are matched to it.
export function stationPoints(data: HeartbeatData): GeoJSON.FeatureCollection<GeoJSON.Point> {
    return {
        type: 'FeatureCollection',
        features: data.stations.map((station, index) => ({
            type: 'Feature',
            id: index,
            geometry: { type: 'Point', coordinates: station.position },
            properties: {}
        }))
    };
}

// Every station's size and colour at a (fractional) bin position, in station
// order, computed with the same rules as the deck.gl layer
export function stationStyles(data: HeartbeatData, binPosition: number): StationStyle[] {
    return activitiesAtPosition(data, binPosition).map((activity) => {
        const [r, g, b, a] = stationColor(activity);
        return {
            radius: stationRadius(activity),
            color: `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`
        };
    });
}

// Metres per pixel at zoom 0 on the equator, for 512-pixel tiles as MapLibre uses
const EQUATOR_METERS_PER_PIXEL_Z0 = 78271.517;
// Latitude used for the metres-to-pixels scale. Across the station network
// (51.45 to 51.55) it varies by about 0.1%, which is invisible.
const LONDON_LATITUDE = 51.5;
const MAX_ZOOM = 24;

// A circle's radius from its feature state, or 0 before its first style is set
const STYLE_RADIUS = ['coalesce', ['feature-state', 'radius'], 0];

// MapLibre paint for the station circles. MapLibre sizes circles in pixels, so
// each zoom level gets its own metres-to-pixels factor (doubling per level), and
// the dots match the deck.gl path's sizes in metres.
export function stationCirclePaint(): CircleLayerSpecification['paint'] {
    const metersPerPixelZ0 =
        EQUATOR_METERS_PER_PIXEL_Z0 * Math.cos((LONDON_LATITUDE * Math.PI) / 180);
    const stops: unknown[] = [];
    for (let zoom = 0; zoom <= MAX_ZOOM; zoom++) {
        stops.push(zoom, [
            'max',
            RADIUS_MIN_PIXELS,
            ['*', STYLE_RADIUS, 2 ** zoom / metersPerPixelZ0]
        ]);
    }

    return {
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], ...stops],
        'circle-color': ['coalesce', ['feature-state', 'color'], 'rgba(0, 0, 0, 0)'],
        'circle-stroke-color': `rgba(${OUTLINE_COLOR.slice(0, 3).join(', ')}, ${(
            OUTLINE_COLOR[3] / 255
        ).toFixed(2)})`,
        'circle-stroke-width': 1
    } as CircleLayerSpecification['paint'];
}

function lerp(from: number, to: number, t: number) {
    return from + (to - from) * t;
}
