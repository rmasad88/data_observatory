/// <reference types="node" />
// Node types for the contract tests, which read the generated files from disk
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import {
    dequantise,
    loadPathDay,
    loadPathsIndex,
    parsePathDay,
    parsePathsIndex,
    type PathsIndex
} from './data';

// A box 0.2 degrees wide and tall, so one step is 0.2 / 4 = 0.05 degrees
const INDEX: PathsIndex = {
    start: '2024-07-01T00:00:00',
    bounds: [-0.2, 51.4, 0.0, 51.6],
    coordinateSteps: 4,
    terminals: ['001023', '001018'],
    days: [{ date: '2024-07-01', file: '2024-07-01.bin', routes: 2, points: 5, journeys: 2 }]
};

// Two routes (3 and 2 points) and two journeys, laid out as build_paths.py does
function makeDayBytes(): ArrayBuffer {
    const parts = [
        new Uint32Array([0, 3, 5]),
        new Uint32Array([1, 0]),
        new Uint32Array([28_800, 30_600]),
        new Uint16Array([600, 900]),
        // The first route runs from the second terminal to the first
        new Uint16Array([1, 0, 0, 1]),
        new Uint16Array([0, 0, 2, 2, 4, 4, 4, 0, 0, 4])
    ];
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
        bytes.set(new Uint8Array(part.buffer), offset);
        offset += part.byteLength;
    }
    return bytes.buffer;
}

describe('parsePathsIndex', () => {
    it('reads the index', () => {
        expect(parsePathsIndex(JSON.parse(JSON.stringify(INDEX)))).toEqual(INDEX);
    });

    it.each([
        ['not an object', 'paths'],
        ['no days', { ...INDEX, days: [] }],
        ['bad bounds', { ...INDEX, bounds: [0, 1] }],
        ['no terminals', { ...INDEX, terminals: undefined }],
        ['a malformed day', { ...INDEX, days: [{ date: '2024-07-01' }] }]
    ])('rejects %s', (_label, value) => {
        expect(() => parsePathsIndex(value)).toThrow();
    });
});

describe('parsePathDay', () => {
    it('reads the routes and journeys', () => {
        const day = parsePathDay(INDEX, INDEX.days[0], makeDayBytes());

        expect(Array.from(day.routeOffsets)).toEqual([0, 3, 5]);
        expect(Array.from(day.journeyRoute)).toEqual([1, 0]);
        expect(Array.from(day.journeyStart)).toEqual([28_800, 30_600]);
        expect(Array.from(day.journeyDuration)).toEqual([600, 900]);
        expect(Array.from(day.routeStations)).toEqual([1, 0, 0, 1]);
        expect(day.positions).toHaveLength(10);
    });

    it('turns stored steps back into coordinates', () => {
        const day = parsePathDay(INDEX, INDEX.days[0], makeDayBytes());

        // The first route: the box's south-west corner, centre and north-east
        expect(Array.from(day.positions.slice(0, 6))).toEqual(
            [-0.2, 51.4, -0.1, 51.5, 0.0, 51.6].map((value) => Math.fround(value))
        );
    });

    it('rejects a file of the wrong size', () => {
        expect(() => parsePathDay(INDEX, INDEX.days[0], new ArrayBuffer(12))).toThrow(/2024-07-01/);
    });
});

describe('dequantise', () => {
    it('maps steps across the bounds', () => {
        expect(Array.from(dequantise(INDEX, new Uint16Array([1, 3])))).toEqual([
            Math.fround(-0.15),
            Math.fround(51.55)
        ]);
    });
});

describe('loading', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('fetches the index, then a day file it names', async () => {
        const fetchMock = vi.fn(async (url: string) =>
            url.endsWith('paths.json')
                ? new Response(JSON.stringify(INDEX))
                : new Response(makeDayBytes())
        );
        vi.stubGlobal('fetch', fetchMock);

        const index = await loadPathsIndex('/data/paths');
        const day = await loadPathDay(index, 0, '/data/paths');

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/data/paths/paths.json',
            '/data/paths/2024-07-01.bin'
        ]);
        expect(day.date).toBe('2024-07-01');
    });

    it('throws when a file is missing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 404 }))
        );

        await expect(loadPathsIndex('/data/paths')).rejects.toThrow(/404/);
    });
});

describe('generated path files', () => {
    // Checks the committed export still matches what this loader expects
    const dir = fileURLToPath(new URL('../../../public/data/paths/', import.meta.url));
    const index = parsePathsIndex(JSON.parse(readFileSync(`${dir}paths.json`, 'utf8')));
    const readDay = (day: number) => {
        const bytes = readFileSync(`${dir}${index.days[day].file}`);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return parsePathDay(index, index.days[day], buffer);
    };

    it('covers the fortnight', () => {
        expect(index.days).toHaveLength(14);
        expect(index.days[0].date).toBe('2024-07-01');
    });

    it('has every journey between different stations', () => {
        const total = index.days.reduce((sum, day) => sum + day.journeys, 0);

        // Matches the Python pipeline: 357,228 journeys less 10,889 round trips
        expect(total).toBe(346_339);
    });

    it('only joins stations the heartbeat knows', () => {
        const heartbeatDir = fileURLToPath(
            new URL('../../../public/data/heartbeat/', import.meta.url)
        );
        const heartbeat = JSON.parse(readFileSync(`${heartbeatDir}stations.json`, 'utf8')) as {
            stations: { terminal: string }[];
        };
        const known = new Set(heartbeat.stations.map((station) => station.terminal));

        expect(index.terminals.filter((terminal) => !known.has(terminal))).toEqual([]);
        expect(Math.max(...readDay(0).routeStations)).toBeLessThan(index.terminals.length);
    });

    it('parses a day, with journeys in start order inside that day', () => {
        const day = readDay(0);
        const starts = Array.from(day.journeyStart);

        expect(starts.every((start, i) => i === 0 || start >= starts[i - 1])).toBe(true);
        expect(starts[0]).toBeGreaterThanOrEqual(0);
        expect(starts.at(-1)).toBeLessThan(24 * 3600);
    });
});
