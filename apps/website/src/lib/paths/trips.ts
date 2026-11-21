// Turns a day of journeys into moving trails. Each journey runs along its
// estimated route at a steady speed, from its real start time for its real
// duration, drawn with deck.gl's TripsLayer as a short fading trail.

import { TripsLayer } from '@deck.gl/geo-layers';

import type { RGB } from '../heartbeat/layer';
import type { PathDay } from './data';

// How much of each ride's recent path is visible behind it, in simulated
// minutes
export const TRAIL_MINUTES = 8;
// Faint warm white: reads as movement without competing with the red and blue
// of the stations
export const TRAIL_COLOR: RGB = [255, 226, 190];
const TRAIL_OPACITY = 0.35;
// Metres, so trails scale with the map like the dots, but never thinner than
// a pixel
const TRAIL_WIDTH_METERS = 8;
const TRAIL_MIN_PIXELS = 1;
const SECONDS_PER_MINUTE = 60;

export type Trip = {
    // Longitude, latitude pairs: a view into the day's shared positions
    path: Float32Array;
    // When the ride passes each point, in minutes since the data's start
    timestamps: Float32Array;
};

export type DayTrips = {
    date: string;
    trips: Trip[];
};

// Every journey in a day as a trip with a time at each point of its route
export function buildDayTrips(day: PathDay): DayTrips {
    const routeCount = day.routeOffsets.length - 1;
    // How far along each route each point is (0 to 1), worked out once per
    // route and shared by every journey on it
    const progress = Array.from({ length: routeCount }, (_, route) =>
        routeProgress(
            day.positions.subarray(day.routeOffsets[route] * 2, day.routeOffsets[route + 1] * 2)
        )
    );

    const trips = Array.from(day.journeyRoute, (route, journey) => {
        const start = day.journeyStart[journey] / SECONDS_PER_MINUTE;
        const duration = day.journeyDuration[journey] / SECONDS_PER_MINUTE;
        const along = progress[route];
        const timestamps = new Float32Array(along.length);
        for (let i = 0; i < along.length; i++) {
            timestamps[i] = start + duration * along[i];
        }
        return {
            path: day.positions.subarray(
                day.routeOffsets[route] * 2,
                day.routeOffsets[route + 1] * 2
            ),
            timestamps
        };
    });
    return { date: day.date, trips };
}

// Each point's share of the way along a route (longitude, latitude pairs),
// by distance. A route with no length moves evenly from point to point.
export function routeProgress(path: Float32Array): Float32Array {
    const count = path.length / 2;
    const progress = new Float32Array(count);
    if (count < 2) return progress;

    // Degrees of longitude are shorter than degrees of latitude in London
    const xScale = Math.cos((path[1] * Math.PI) / 180);
    let total = 0;
    for (let i = 1; i < count; i++) {
        const dx = (path[i * 2] - path[i * 2 - 2]) * xScale;
        const dy = path[i * 2 + 1] - path[i * 2 - 1];
        total += Math.hypot(dx, dy);
        progress[i] = total;
    }
    for (let i = 1; i < count; i++) {
        progress[i] = total > 0 ? progress[i] / total : i / (count - 1);
    }
    return progress;
}

// The trails of a day's journeys at a moment (minutes since the data's start).
// `timeShift` moves the day by whole periods so the fortnight loops: the last
// day's late rides show at the start of the next lap.
export function createTripsLayer(dayTrips: DayTrips, minutes: number, timeShift = 0) {
    return new TripsLayer<Trip>({
        id: `trips-${dayTrips.date}`,
        // The same array every frame, so deck.gl uploads the trips once and
        // each frame only moves the time
        data: dayTrips.trips,
        getPath: (trip) => trip.path as unknown as number[],
        positionFormat: 'XY',
        getTimestamps: (trip) => trip.timestamps as unknown as number[],
        getColor: TRAIL_COLOR,
        opacity: TRAIL_OPACITY,
        widthUnits: 'meters',
        getWidth: TRAIL_WIDTH_METERS,
        widthMinPixels: TRAIL_MIN_PIXELS,
        capRounded: true,
        jointRounded: true,
        fadeTrail: true,
        trailLength: TRAIL_MINUTES,
        currentTime: minutes + timeShift
    });
}
