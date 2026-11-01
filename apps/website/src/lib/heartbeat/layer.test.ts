import { describe, expect, it } from 'vite-plus/test';

import type { HeartbeatData } from './data';
import {
    COLOR_BALANCED,
    COLOR_GAINING,
    COLOR_LOSING,
    RADIUS_BASE_METERS,
    RADIUS_MIN_PIXELS,
    RADIUS_PER_SQRT_JOURNEY_METERS,
    activityAt,
    activityAtPosition,
    binPositionAt,
    createStationLayer,
    stationCirclePaint,
    stationColor,
    stationPoints,
    stationStyles,
    stationRadius
} from './layer';

// Two stations over five bins. Station 0 has departures 0, 3, 6, 9, 12 and no
// arrivals; station 1 has arrivals only.
function makeData(): HeartbeatData {
    return {
        start: '2024-07-01T00:00:00',
        binMinutes: 10,
        binCount: 5,
        stations: [
            {
                terminal: '000001',
                name: 'First Street',
                position: [-0.1, 51.5],
                docks: 20,
                source: '2024-08-20 snapshot'
            },
            {
                terminal: '000002',
                name: 'Second Street',
                position: [-0.2, 51.6],
                docks: 30,
                source: 'current list'
            }
        ],
        departures: new Uint16Array([0, 3, 6, 9, 12, 0, 0, 0, 0, 0]),
        arrivals: new Uint16Array([0, 0, 0, 0, 0, 2, 2, 2, 2, 2])
    };
}

describe('activityAt', () => {
    it('averages a bin with its neighbours', () => {
        // Default 50-minute window: (0 + 3 + 6 + 9 + 12) / 5
        expect(activityAt(makeData(), 0, 2)).toEqual({ departures: 6, arrivals: 0 });
        // 30-minute window: (3 + 6 + 9) / 3
        expect(activityAt(makeData(), 0, 2, 1)).toEqual({ departures: 6, arrivals: 0 });
    });

    it('averages only the bins that exist at the edges', () => {
        // With a 30-minute window. First bin: (0 + 3) / 2; last: (9 + 12) / 2
        expect(activityAt(makeData(), 0, 0, 1).departures).toBe(1.5);
        expect(activityAt(makeData(), 0, 4, 1).departures).toBe(10.5);
    });

    it('returns the raw counts without smoothing', () => {
        expect(activityAt(makeData(), 0, 3, 0)).toEqual({ departures: 9, arrivals: 0 });
        expect(activityAt(makeData(), 1, 3, 0)).toEqual({ departures: 0, arrivals: 2 });
    });
});

describe('stationRadius', () => {
    it('is the base radius for an idle station', () => {
        expect(stationRadius({ departures: 0, arrivals: 0 })).toBe(RADIUS_BASE_METERS);
    });

    it('grows with the square root of total journeys', () => {
        // 4 journeys -> sqrt = 2; 16 journeys -> sqrt = 4, so twice the growth
        const four = stationRadius({ departures: 3, arrivals: 1 });
        const sixteen = stationRadius({ departures: 8, arrivals: 8 });

        expect(four).toBe(RADIUS_BASE_METERS + 2 * RADIUS_PER_SQRT_JOURNEY_METERS);
        expect(sixteen - RADIUS_BASE_METERS).toBe(2 * (four - RADIUS_BASE_METERS));
    });
});

describe('stationColor', () => {
    it('is grey when arrivals and departures balance', () => {
        expect(stationColor({ departures: 10, arrivals: 10 }).slice(0, 3)).toEqual(COLOR_BALANCED);
    });

    it('moves towards red when losing bikes and blue when gaining', () => {
        const losing = stationColor({ departures: 100, arrivals: 0 });
        const gaining = stationColor({ departures: 0, arrivals: 100 });

        // Close to the pole: net share is 100 / 101
        losing.slice(0, 3).forEach((value, i) => expect(value).toBeCloseTo(COLOR_LOSING[i], -1));
        gaining.slice(0, 3).forEach((value, i) => expect(value).toBeCloseTo(COLOR_GAINING[i], -1));
    });

    it("doesn't let one journey at a quiet station saturate the colour", () => {
        // Net share is 1 / (1 + 1): halfway between grey and red
        const [red] = stationColor({ departures: 1, arrivals: 0 });

        expect(red).toBe(Math.round((COLOR_BALANCED[0] + COLOR_LOSING[0]) / 2));
    });

    it('fades quiet stations and shows busy ones fully', () => {
        expect(stationColor({ departures: 0, arrivals: 0 })[3]).toBe(60);
        expect(stationColor({ departures: 3, arrivals: 3 })[3]).toBe(255);
        expect(stationColor({ departures: 30, arrivals: 30 })[3]).toBe(255);
    });
});

describe('createStationLayer', () => {
    it('draws one dot per station, sized and coloured for the bin', () => {
        const data = makeData();
        const layer = createStationLayer(data, 2);
        const { getRadius, getFillColor, getPosition } = layer.props as unknown as {
            getRadius: (d: unknown, info: { index: number }) => number;
            getFillColor: (d: unknown, info: { index: number }) => number[];
            getPosition: (d: (typeof data.stations)[number]) => [number, number];
        };

        expect(layer.props.data).toBe(data.stations);
        expect(getPosition(data.stations[1])).toEqual([-0.2, 51.6]);
        expect(getRadius(null, { index: 0 })).toBe(stationRadius(activityAt(data, 0, 2)));
        expect(getFillColor(null, { index: 1 })).toEqual(stationColor(activityAt(data, 1, 2)));
    });
});

describe('stationPoints', () => {
    it('gives each station a point whose id is its index', () => {
        const { features } = stationPoints(makeData());

        expect(features.map((feature) => feature.id)).toEqual([0, 1]);
        expect(features[1].geometry.coordinates).toEqual([-0.2, 51.6]);
    });
});

describe('stationStyles', () => {
    it('matches the deck.gl layer for every station', () => {
        const data = makeData();
        const styles = stationStyles(data, 2.5);
        const activity = activityAtPosition(data, 0, 2.5);
        const [r, g, b, a] = stationColor(activity);

        expect(styles).toHaveLength(2);
        expect(styles[0]).toEqual({
            radius: stationRadius(activity),
            color: `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`
        });
    });
});

describe('stationCirclePaint', () => {
    // The paint's radius expression: interpolate over zoom with one stop per level
    const radiusStops = () =>
        (stationCirclePaint() as { 'circle-radius': unknown[] })['circle-radius'].slice(3);

    it('converts metres to pixels at each zoom level', () => {
        const stops = radiusStops();
        const zoom13 = stops[stops.indexOf(13) + 1] as [string, number, [string, unknown, number]];
        const pixelsPerMetre = zoom13[2][2];

        // At zoom 13 and London's latitude a pixel is about 5.97 m, so a 100 m
        // radius is about 16.8 pixels
        expect(100 * pixelsPerMetre).toBeCloseTo(16.8, 1);
    });

    it('reads size and colour from feature state', () => {
        const paint = stationCirclePaint() as Record<string, unknown>;

        expect(JSON.stringify(paint['circle-radius'])).toContain('"feature-state","radius"');
        expect(JSON.stringify(paint['circle-color'])).toContain('"feature-state","color"');
    });

    it('keeps a minimum dot size when zoomed out', () => {
        const stops = radiusStops();
        const zoom0 = stops[1] as [string, number, unknown];

        expect(zoom0[0]).toBe('max');
        expect(zoom0[1]).toBe(RADIUS_MIN_PIXELS);
    });
});

describe('binPositionAt', () => {
    it.each([
        // The middle of the first bin (00:05) is position 0
        [5, 0],
        // 00:20 is the middle of bin 1 plus half a bin
        [20, 1.5],
        // Just after the start shows the end of the period, blending into bin 0
        [0, 4.5],
        // Past the end wraps round: 50 minutes is 00:00 again
        [55, 0]
    ])('maps %d minutes to position %d', (minutes, expected) => {
        expect(binPositionAt(makeData(), minutes)).toBeCloseTo(expected);
    });
});

// One station over eight bins with a single spike in the middle
function makeSpikeData(): HeartbeatData {
    const data = makeData();
    return {
        ...data,
        binCount: 8,
        stations: [data.stations[0]],
        departures: new Uint16Array([0, 0, 0, 0, 40, 0, 0, 0]),
        arrivals: new Uint16Array(8)
    };
}

describe('activityAtPosition', () => {
    it('passes exactly through the bin values', () => {
        const data = makeData();

        expect(activityAtPosition(data, 0, 3)).toEqual(activityAt(data, 0, 3));
    });

    it('follows a straight line where the bins do', () => {
        const data = makeData();
        // Smoothed bins 0 to 3 are 3, 4.5, 6, 7.5: a quarter from bin 1 to 2
        expect(activityAtPosition(data, 0, 1.25).departures).toBeCloseTo(4.875);
    });

    it('has no kink at a bin: the slope is the same either side', () => {
        const data = makeSpikeData();
        const at = (position: number) => activityAtPosition(data, 0, position).departures;
        const step = 1e-4;
        // Bin 2 is where the smoothed spike levels off (bins 1, 2, 3 = 0, 8, 8),
        // so straight-line blending would turn sharply here: slope 8, then 0
        const slopeBefore = (at(2) - at(2 - step)) / step;
        const slopeAfter = (at(2 + step) - at(2)) / step;

        expect(slopeAfter).toBeCloseTo(slopeBefore, 1);
    });

    it('never goes below zero beside a spike', () => {
        const data = makeSpikeData();

        for (let position = 0; position < 8; position += 0.05) {
            expect(activityAtPosition(data, 0, position).departures).toBeGreaterThanOrEqual(0);
        }
    });

    it('runs from the last bin into the first without a jump', () => {
        const data = makeData();

        expect(activityAtPosition(data, 0, 4.9999).departures).toBeCloseTo(
            activityAt(data, 0, 0).departures,
            2
        );
    });
});
