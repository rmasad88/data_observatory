import { describe, expect, it } from 'vite-plus/test';

import { dayTicks, periodMinutes, stationTooltip, stepHours } from './explore';
import type { HeartbeatPeriod, HeartbeatStation } from './heartbeat/data';

// The real data's period: 14 days of 10-minute bins from Monday 1 July 2024
const FORTNIGHT: HeartbeatPeriod = {
    start: '2024-07-01T00:00:00',
    binMinutes: 10,
    binCount: 14 * 24 * 6
};

const STATION: HeartbeatStation = {
    terminal: '001234',
    name: 'Waterloo Station 3, Waterloo',
    position: [-0.11, 51.5],
    docks: 40,
    source: '2024-08-20 snapshot'
};

describe('dayTicks', () => {
    it('marks each midnight of the period', () => {
        const ticks = dayTicks(FORTNIGHT);

        expect(ticks).toHaveLength(14);
        expect(ticks[0]).toEqual({ minutes: 0, label: 'Mon 1' });
        expect(ticks[13]).toEqual({ minutes: 13 * 24 * 60, label: 'Sun 14' });
    });
});

describe('stepHours', () => {
    it('moves forwards and backwards by hours', () => {
        expect(stepHours(FORTNIGHT, 600, 1)).toBe(660);
        expect(stepHours(FORTNIGHT, 600, -2)).toBe(480);
    });

    it('loops round the ends of the period', () => {
        expect(stepHours(FORTNIGHT, 30, -1)).toBe(periodMinutes(FORTNIGHT) - 30);
        expect(stepHours(FORTNIGHT, periodMinutes(FORTNIGHT) - 30, 1)).toBe(30);
    });
});

describe('stationTooltip', () => {
    it('gives the name and journeys per hour', () => {
        // Per 10-minute bin, so six times as many per hour
        const text = stationTooltip(FORTNIGHT, STATION, { departures: 2, arrivals: 0.5 });

        expect(text).toBe('Waterloo Station 3, Waterloo\n12 departures · 3 arrivals per hour');
    });
});
