import { describe, expect, it } from 'vite-plus/test';

import type { PathDay } from './data';
import {
    buildDayTrips,
    createTripsLayer,
    filterTrips,
    routeProgress,
    TRAIL_BLENDING,
    TRAIL_MINUTES,
    tripsDuring
} from './trips';

// Two routes: an L shape (east 2 units, then north 1) and a single step north.
// Near the equator so degrees of longitude and latitude are the same length.
function makeDay(): PathDay {
    return {
        date: '2024-07-01',
        routeOffsets: new Uint32Array([0, 3, 5]),
        positions: new Float32Array([0, 0, 2, 0, 2, 1, 5, 5, 5, 6]),
        // The L route twice and the short one once
        journeyRoute: new Uint32Array([0, 1, 0]),
        // 08:00, 08:30 and 09:00, in seconds
        journeyStart: new Uint32Array([28_800, 30_600, 32_400]),
        // 15, 6 and 30 minutes
        journeyDuration: new Uint16Array([900, 360, 1800]),
        // The L route from station 0 to 1, the short one from 1 to 2
        routeStations: new Uint16Array([0, 1, 1, 2])
    };
}

describe('routeProgress', () => {
    it("gives each point's share of the distance", () => {
        // 2 of 3 units at the corner
        const progress = routeProgress(new Float32Array([0, 0, 2, 0, 2, 1]));

        expect(Array.from(progress)).toEqual([0, Math.fround(2 / 3), 1]);
    });

    it('moves evenly along a route with no length', () => {
        expect(Array.from(routeProgress(new Float32Array([1, 1, 1, 1, 1, 1])))).toEqual([
            0, 0.5, 1
        ]);
    });
});

describe('buildDayTrips', () => {
    const { date, trips } = buildDayTrips(makeDay());

    it('makes one trip per journey on its route', () => {
        expect(date).toBe('2024-07-01');
        expect(trips).toHaveLength(3);
        expect(Array.from(trips[1].path)).toEqual([5, 5, 5, 6]);
    });

    it('runs each journey from its start for its duration, at a steady speed', () => {
        // 08:00 for 15 minutes: the corner is two-thirds of the way along
        expect(Array.from(trips[0].timestamps)).toEqual(
            [480, 490, 495].map((minutes) => Math.fround(minutes))
        );
        // The same route later and slower
        expect(Array.from(trips[2].timestamps)).toEqual(
            [540, 560, 570].map((minutes) => Math.fround(minutes))
        );
    });

    it("gives each trip its route's stations", () => {
        expect(trips.map(({ from, to }) => [from, to])).toEqual([
            [0, 1],
            [1, 2],
            [0, 1]
        ]);
    });

    it('shares route points between journeys rather than copying them', () => {
        expect(trips[0].path.buffer).toBe(trips[2].path.buffer);
    });
});

describe('filterTrips', () => {
    const dayTrips = buildDayTrips(makeDay());

    it('keeps trips that start or end at a chosen station', () => {
        // Station 2 is only the short route's end
        expect(filterTrips(dayTrips, new Set([2])).trips).toEqual([dayTrips.trips[1]]);
        // Station 1 is on both routes
        expect(filterTrips(dayTrips, new Set([1])).trips).toHaveLength(3);
        expect(filterTrips(dayTrips, new Set([7])).trips).toEqual([]);
    });
});

describe('tripsDuring', () => {
    // On the road 480-495, 510-516 and 540-570, each trailing for
    // TRAIL_MINUTES after
    const { trips } = buildDayTrips(makeDay());
    const trailEnd = 495 + TRAIL_MINUTES;

    it('keeps trips on the road or still trailing during the window', () => {
        expect(tripsDuring(trips, trailEnd, 520)).toEqual([trips[0], trips[1]]);
        // The first has finished trailing and the second not yet started
        expect(tripsDuring(trips, trailEnd + 1, 510)).toEqual([]);
        // A trip starting exactly at the window's end isn't in it
        expect(tripsDuring(trips, 516, 540)).toEqual([trips[1]]);
    });

    it('compares in the time shown, after the shift', () => {
        // Drawn a period later, so these rides show 20,160 minutes earlier
        expect(tripsDuring(trips, trailEnd - 20_160, 520 - 20_160, 20_160)).toEqual([
            trips[0],
            trips[1]
        ]);
    });
});

describe('createTripsLayer', () => {
    it('shows the trails at the moment given, shifted by whole periods', () => {
        const dayTrips = buildDayTrips(makeDay());

        const layer = createTripsLayer('trips-a', dayTrips.trips, 500, 20_160, false);

        expect(layer.id).toBe('trips-a');
        expect(layer.props.visible).toBe(false);
        expect(layer.props.currentTime).toBe(20_660);
        expect(layer.props.trailLength).toBe(TRAIL_MINUTES);
        // Overlapping trails add up, so busy streets stand out
        expect(layer.props.parameters).toBe(TRAIL_BLENDING);
        expect(layer.props.data).toBe(dayTrips.trips);
    });
});
