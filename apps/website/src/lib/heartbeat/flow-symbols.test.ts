import { describe, expect, it } from 'vite-plus/test';

import type { HeartbeatData, HeartbeatStation } from './data';
import {
    BIKES_PER_SYMBOL,
    buildFlowSchedule,
    createFlowSymbolLayer,
    FLOW_QUIET_BIKES,
    flowSymbolsAt,
    symbolOpacity,
    symbolPosition,
    type FlowSymbol
} from './flow-symbols';
import { activityAtPosition } from './layer';

const BINS = 24;

function station(terminal: string): HeartbeatStation {
    return {
        terminal,
        name: `Station ${terminal}`,
        position: [-0.1, 51.5],
        docks: 20,
        source: '2024-08-20 snapshot'
    };
}

// Four stations over four hours, each with the same counts in every bin, so
// the smoothed values equal the counts:
// 0 has 3 arrivals per bin, 1 has 3 departures, 2 is busy but balanced (5 of
// each), and 3 has one arrival every fourth bin (0.25 per bin after smoothing,
// below the quiet level)
function makeData(): HeartbeatData {
    const departures = new Uint16Array(4 * BINS);
    const arrivals = new Uint16Array(4 * BINS);
    // One station's bins are stored together
    const at = (stationIndex: number, bin: number) => stationIndex * BINS + bin;
    for (let bin = 0; bin < BINS; bin++) {
        arrivals[at(0, bin)] = 3;
        departures[at(1, bin)] = 3;
        arrivals[at(2, bin)] = 5;
        departures[at(2, bin)] = 5;
        arrivals[at(3, bin)] = bin % 4 === 0 ? 1 : 0;
    }
    return {
        start: '2024-07-01T00:00:00',
        binMinutes: 10,
        binCount: BINS,
        stations: ['000001', '000002', '000003', '000004'].map(station),
        departures,
        arrivals
    };
}

function symbolsOf(symbols: FlowSymbol[], stationIndex: number) {
    return symbols.filter((symbol) => symbol.station === stationIndex);
}

describe('flowSymbolsAt', () => {
    const data = makeData();
    const schedule = buildFlowSchedule(data);
    // At 24 simulated minutes per second a symbol lives 1.5 s = 36 minutes.
    // Station 0 releases (3 - 0.5) / 1 = 2.5 symbols per 10 minutes, one every
    // 4 minutes, so 36 / 4 = 9 are in the air at once.
    const symbols = flowSymbolsAt(data, schedule, 120, 24);

    it('releases symbols at a rate set by the arrivals', () => {
        expect(symbolsOf(symbols, 0)).toHaveLength(9);
    });

    it('spaces them evenly, each between release and disappearing', () => {
        const ages = symbolsOf(symbols, 0)
            .map((symbol) => symbol.age)
            .sort((a, b) => a - b);

        ages.forEach((age) => {
            expect(age).toBeGreaterThanOrEqual(0);
            expect(age).toBeLessThan(1);
        });
        // One every 4 minutes of a 36-minute life
        for (let i = 1; i < ages.length; i++) {
            expect(ages[i] - ages[i - 1]).toBeCloseTo(4 / 36);
        }
    });

    it('shows + for arrivals and − for departures', () => {
        expect(symbolsOf(symbols, 0).every((symbol) => symbol.direction === 1)).toBe(true);
        expect(symbolsOf(symbols, 1)).toHaveLength(9);
        expect(symbolsOf(symbols, 1).every((symbol) => symbol.direction === -1)).toBe(true);
    });

    it('releases both symbols, equally, at a busy balanced station', () => {
        const balanced = symbolsOf(symbols, 2);
        const plus = balanced.filter((symbol) => symbol.direction === 1).length;
        const minus = balanced.filter((symbol) => symbol.direction === -1).length;

        // (5 - 0.5) per 10 minutes for 36 minutes is 16.2 of each
        expect(plus).toBeGreaterThanOrEqual(16);
        expect(plus).toBeLessThanOrEqual(17);
        expect(Math.abs(plus - minus)).toBeLessThanOrEqual(1);
    });

    it('stays quiet below the quiet level', () => {
        expect(symbolsOf(symbols, 3)).toHaveLength(0);
    });

    it('keeps each symbol in the air for the same real time at any speed', () => {
        // Twice as fast: a 72-minute life, so twice as many in the air
        expect(symbolsOf(flowSymbolsAt(data, schedule, 120, 48), 0)).toHaveLength(18);
    });

    it('continues round the loop at the start of the period', () => {
        const nearStart = symbolsOf(flowSymbolsAt(data, schedule, 5, 24), 0);

        expect(nearStart).toHaveLength(9);
        nearStart.forEach((symbol) => {
            expect(symbol.age).toBeGreaterThanOrEqual(0);
            expect(symbol.age).toBeLessThan(1);
        });
    });

    it('gives the same symbols every time, so wall screens agree', () => {
        expect(flowSymbolsAt(data, schedule, 120, 24)).toEqual(symbols);
    });
});

describe('buildFlowSchedule', () => {
    it('uses the same smoothed counts as the dots', () => {
        // Station 3's arrivals vary from bin to bin, so smoothing matters
        const data = makeData();
        const schedule = buildFlowSchedule(data);
        const width = data.binCount + 1;

        for (let bin = 0; bin < data.binCount; bin++) {
            const { arrivals } = activityAtPosition(data, 3, bin);
            const expected = Math.max(0, arrivals - FLOW_QUIET_BIKES) / BIKES_PER_SYMBOL;
            const released =
                schedule.arrivals[3 * width + bin + 1] - schedule.arrivals[3 * width + bin];
            expect(released).toBeCloseTo(expected, 5);
        }
    });
});

describe('symbolOpacity', () => {
    it('fades in from nothing and out to nothing', () => {
        expect(symbolOpacity(0)).toBe(0);
        expect(symbolOpacity(1)).toBe(0);
        expect(symbolOpacity(0.5)).toBeGreaterThan(0.4);
    });
});

describe('symbolPosition', () => {
    it('floats upwards as the symbol ages', () => {
        const data = makeData();
        const young = symbolPosition(data, { station: 0, direction: 1, age: 0, jitter: 0 });
        const old = symbolPosition(data, { station: 0, direction: 1, age: 1, jitter: 0 });

        expect(old[1]).toBeGreaterThan(young[1]);
        expect(old[0]).toBe(young[0]);
    });
});

describe('createFlowSymbolLayer', () => {
    it('draws a + or − per symbol', () => {
        const data = makeData();
        const layer = createFlowSymbolLayer(data, buildFlowSchedule(data), 120, 24);
        const getText = layer.props.getText as (symbol: FlowSymbol) => string;

        expect(getText({ station: 0, direction: 1, age: 0.5, jitter: 0 })).toBe('+');
        expect(getText({ station: 1, direction: -1, age: 0.5, jitter: 0 })).toBe('−');
    });
});
