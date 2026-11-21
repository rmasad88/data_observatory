// Floating + and − symbols that rise from stations as bikes arrive and leave,
// so the activity reads without the legend: a blue + for arrivals, a red − for
// departures. A busy but balanced station fizzes with both; one losing bikes
// releases mostly −. Each stream follows the smoothed counts (the same
// smoothing as the dots), so occasional single journeys stay quiet.
//
// Symbols are worked out from the playback time alone, never randomly, so
// every wall screen shows the same symbols at the same moment.

import { TextLayer } from '@deck.gl/layers';

import { NO_SELECTION, UNSELECTED_DIMMING, type Selection } from '../station-selection';
import type { HeartbeatData } from './data';
import { COLOR_GAINING, COLOR_LOSING, SMOOTHING_SIGMA_MINUTES, smoothingWeights } from './layer';

// Departures or arrivals below this (bikes per 10 minutes, after smoothing)
// release nothing, so quiet stations stay calm
export const FLOW_QUIET_BIKES = 0.5;
// Each symbol stands for this many bikes above the quiet level
export const BIKES_PER_SYMBOL = 1;
// How long a symbol is visible, in real seconds, whatever the playback speed
export const SYMBOL_LIFETIME_SECONDS = 1.5;

// How high a symbol floats over its life, and its size, in metres so it
// scales with the map like the dots
const SYMBOL_RISE_METERS = 450;
const SYMBOL_START_METERS = 60;
const SYMBOL_SIZE_METERS = 160;
// Symbols are nudged up to this far left or right, so a busy station's stream
// of symbols doesn't stack in one column
const SYMBOL_SPREAD_METERS = 60;
const SYMBOL_MIN_PIXELS = 9;
const METERS_PER_DEGREE_LATITUDE = 111_320;
const MINUS_SIGN = '−';

// When each station releases its symbols, worked out once for the whole
// period. Each is a running total of symbols released before each bin starts
// (stations × (bins + 1), one station's bins together).
export type FlowSchedule = {
    // − symbols, from departures
    departures: Float32Array;
    // + symbols, from arrivals
    arrivals: Float32Array;
};

// One symbol in the air
export type FlowSymbol = {
    station: number;
    // 1 for a + (an arrival), -1 for a − (a departure)
    direction: number;
    // 0 when released, rising to 1 when it disappears
    age: number;
    // A fixed number per symbol, for its sideways nudge (-1 to 1)
    jitter: number;
};

export function buildFlowSchedule(data: HeartbeatData): FlowSchedule {
    return {
        departures: runningTotals(data, data.departures),
        arrivals: runningTotals(data, data.arrivals)
    };
}

// Symbols released before each bin starts, for one kind of count
function runningTotals(data: HeartbeatData, counts: Uint16Array) {
    const { binCount } = data;
    const width = binCount + 1;
    const released = new Float32Array(data.stations.length * width);
    // At a bin's middle the weights are the same for every bin, just shifted,
    // so they are worked out once: weights[i] applies to the bin i - reach away
    const { weights } = smoothingWeights(data, 0, SMOOTHING_SIGMA_MINUTES);
    const reach = (weights.length - 1) / 2;

    for (let station = 0; station < data.stations.length; station++) {
        // One station's bins are stored together
        const first = station * binCount;
        for (let bin = 0; bin < binCount; bin++) {
            let smoothed = 0;
            for (let i = 0; i < weights.length; i++) {
                const other = (((bin + i - reach) % binCount) + binCount) % binCount;
                smoothed += weights[i] * counts[first + other];
            }
            const rate = Math.max(0, smoothed - FLOW_QUIET_BIKES) / BIKES_PER_SYMBOL;
            released[station * width + bin + 1] = released[station * width + bin] + rate;
        }
    }
    return released;
}

// The symbols in the air at a moment (minutes since the data's start) and
// playback speed (simulated minutes per real second)
export function flowSymbolsAt(
    data: HeartbeatData,
    schedule: FlowSchedule,
    minutes: number,
    speed: number
): FlowSymbol[] {
    // A symbol lives this many simulated minutes
    const lifetime = SYMBOL_LIFETIME_SECONDS * speed;
    const streams = [
        { released: schedule.departures, direction: -1 },
        { released: schedule.arrivals, direction: 1 }
    ];
    const symbols: FlowSymbol[] = [];

    for (let station = 0; station < data.stations.length; station++) {
        for (const { released, direction } of streams) {
            const stream = { data, released, offset: station * (data.binCount + 1) };
            const from = releasedBy(stream, minutes - lifetime);
            const to = releasedBy(stream, minutes);
            // Each whole number the running total passed in the window is a symbol
            for (let count = Math.floor(from) + 1; count <= to; count++) {
                const time = releaseTime(stream, count, minutes - lifetime);
                symbols.push({
                    station,
                    direction,
                    age: (minutes - time) / lifetime,
                    // Separate nudges for each station's + and − streams
                    jitter: hashToUnit(station * 2 + (direction > 0 ? 1 : 0), count)
                });
            }
        }
    }
    return symbols;
}

// One station's running total of one kind of symbol
type Stream = { data: HeartbeatData; released: Float32Array; offset: number };

// The running total at a time (minutes). Times before the start or after the
// end continue round the loop, adding a whole period's total per lap.
function releasedBy({ data, released, offset }: Stream, time: number) {
    const total = released[offset + data.binCount];
    const bins = time / data.binMinutes;
    const lap = Math.floor(bins / data.binCount);
    const position = bins - lap * data.binCount;
    const bin = Math.min(Math.floor(position), data.binCount - 1);
    const before = released[offset + bin];
    const after = released[offset + bin + 1];
    return lap * total + before + (after - before) * (position - bin);
}

// The time (minutes) at which the running total reached `count`, searching
// forwards from `startTime`
function releaseTime({ data, released, offset }: Stream, count: number, startTime: number) {
    const total = released[offset + data.binCount];
    let bin = Math.floor(startTime / data.binMinutes);
    for (;;) {
        const lap = Math.floor(bin / data.binCount);
        const index = bin - lap * data.binCount;
        const before = lap * total + released[offset + index];
        const after = lap * total + released[offset + index + 1];
        if (count <= after && after > before) {
            return (bin + (count - before) / (after - before)) * data.binMinutes;
        }
        bin++;
    }
}

// A repeatable number from -1 to 1 for a symbol, so its nudge is the same on
// every screen
function hashToUnit(stream: number, count: number) {
    const value = Math.sin(stream * 12.9898 + count * 78.233) * 43758.5453;
    return (value - Math.floor(value)) * 2 - 1;
}

// The deck.gl layer drawing the symbols in the air at a moment
export function createFlowSymbolLayer(
    data: HeartbeatData,
    schedule: FlowSchedule,
    minutes: number,
    speed: number,
    // While stations are selected, the others' symbols are dimmed with them
    selection: Selection = NO_SELECTION
) {
    const selecting = selection.size > 0;
    return new TextLayer<FlowSymbol>({
        id: 'flow-symbols',
        data: flowSymbolsAt(data, schedule, minutes, speed),
        characterSet: ['+', MINUS_SIGN],
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 'bold',
        getText: (symbol) => (symbol.direction > 0 ? '+' : MINUS_SIGN),
        getPosition: (symbol) => symbolPosition(data, symbol),
        getColor: (symbol) => {
            const [r, g, b] = symbol.direction > 0 ? COLOR_GAINING : COLOR_LOSING;
            const dimming = selecting && !selection.has(symbol.station) ? UNSELECTED_DIMMING : 1;
            return [r, g, b, Math.round(255 * symbolOpacity(symbol.age) * dimming)];
        },
        getSize: SYMBOL_SIZE_METERS,
        sizeUnits: 'meters',
        sizeMinPixels: SYMBOL_MIN_PIXELS,
        // Every symbol moves each frame
        updateTriggers: { getPosition: minutes, getColor: [minutes, selection] }
    });
}

// Above the station, floating up as the symbol ages and nudged sideways
export function symbolPosition(data: HeartbeatData, symbol: FlowSymbol): [number, number] {
    const [longitude, latitude] = data.stations[symbol.station].position;
    const up = SYMBOL_START_METERS + SYMBOL_RISE_METERS * symbol.age;
    const across = SYMBOL_SPREAD_METERS * symbol.jitter;
    const metersPerDegreeLongitude =
        METERS_PER_DEGREE_LATITUDE * Math.cos((latitude * Math.PI) / 180);
    return [
        longitude + across / metersPerDegreeLongitude,
        latitude + up / METERS_PER_DEGREE_LATITUDE
    ];
}

// Fades in quickly, then out over the rest of its life
export function symbolOpacity(age: number) {
    return Math.min(1, age * 8) * (1 - age);
}
