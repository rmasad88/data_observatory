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

// Average each bin with this many bins either side (1 = a 30-minute window), so
// dots follow the trend rather than flickering with 10-minute noise.
export const SMOOTHING_BINS = 1;

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

// A station's smoothed activity around one bin. Bins near the start or end of
// the period average over the bins that exist.
export function activityAt(
    data: HeartbeatData,
    station: number,
    bin: number,
    smoothingBins = SMOOTHING_BINS
): StationActivity {
    const first = Math.max(0, bin - smoothingBins);
    const last = Math.min(data.binCount - 1, bin + smoothingBins);
    let departures = 0;
    let arrivals = 0;
    for (let b = first; b <= last; b++) {
        const index = countIndex(data, station, b);
        departures += data.departures[index];
        arrivals += data.arrivals[index];
    }
    const binsAveraged = last - first + 1;
    return { departures: departures / binsAveraged, arrivals: arrivals / binsAveraged };
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

// The deck.gl layer drawing every station at one bin
export function createStationLayer(data: HeartbeatData, bin: number) {
    // Work out each station's activity once, rather than in both accessors
    const activities = data.stations.map((_, station) => activityAt(data, station, bin));

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
        // Recalculate sizes and colours only when the bin changes
        updateTriggers: {
            getRadius: bin,
            getFillColor: bin
        }
    });
}

// --- Iframe-safe fallback: the same picture drawn with MapLibre's circle layer ---

export type StationFeatureProperties = {
    // Radius in metres, as on the deck.gl path
    radius: number;
    // CSS colour, e.g. "rgba(230, 103, 103, 0.80)"
    color: string;
};

// The stations as GeoJSON points carrying their size and colour for one bin
export function stationFeatures(
    data: HeartbeatData,
    bin: number
): GeoJSON.FeatureCollection<GeoJSON.Point, StationFeatureProperties> {
    return {
        type: 'FeatureCollection',
        features: data.stations.map((station, index) => {
            const activity = activityAt(data, index, bin);
            const [r, g, b, a] = stationColor(activity);
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: station.position },
                properties: {
                    radius: stationRadius(activity),
                    color: `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`
                }
            };
        })
    };
}

// Metres per pixel at zoom 0 on the equator, for 512-pixel tiles as MapLibre uses
const EQUATOR_METERS_PER_PIXEL_Z0 = 78271.517;
// Latitude used for the metres-to-pixels scale. Across the station network
// (51.45 to 51.55) it varies by about 0.1%, which is invisible.
const LONDON_LATITUDE = 51.5;
const MAX_ZOOM = 24;

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
            ['*', ['get', 'radius'], 2 ** zoom / metersPerPixelZ0]
        ]);
    }

    return {
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], ...stops],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': `rgba(${OUTLINE_COLOR.slice(0, 3).join(', ')}, ${(
            OUTLINE_COLOR[3] / 255
        ).toFixed(2)})`,
        'circle-stroke-width': 1
    } as CircleLayerSpecification['paint'];
}

function lerp(from: number, to: number, t: number) {
    return from + (to - from) * t;
}
