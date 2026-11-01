// Runs in Node and reads the committed files from disk. This tells type
// checkers given just this file (e.g. the pre-commit hook) to load Node's types.
/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import {
    countIndex,
    loadHeartbeat,
    loadHeartbeatPeriod,
    parseHeartbeat,
    parseHeartbeatPeriod
} from './data';

// Two stations over three bins, with distinct values so misplaced reads show up
const DEPARTURES = [1, 2, 3, 4, 5, 6];
const ARRIVALS = [7, 8, 9, 10, 11, 12];

function makeMetadata(overrides: Record<string, unknown> = {}) {
    return {
        start: '2024-07-01T00:00:00',
        binMinutes: 10,
        binCount: 3,
        stationCount: 2,
        counts: {
            file: 'counts.bin',
            dtype: 'uint16-le',
            blocks: ['departures', 'arrivals'],
            shape: [2, 3]
        },
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
        ...overrides
    };
}

function makeCounts(values = [...DEPARTURES, ...ARRIVALS]) {
    return new Uint16Array(values).buffer;
}

describe('parseHeartbeat', () => {
    it('reads departures and arrivals for each station and bin', () => {
        const data = parseHeartbeat(makeMetadata(), makeCounts());

        // Station 1, bin 2 is the last value of each block
        expect(data.departures[countIndex(data, 1, 2)]).toBe(6);
        expect(data.arrivals[countIndex(data, 1, 2)]).toBe(12);
        expect(data.departures[countIndex(data, 0, 0)]).toBe(1);
        expect(data.arrivals[countIndex(data, 0, 0)]).toBe(7);
    });

    it('keeps the station details and period', () => {
        const data = parseHeartbeat(makeMetadata(), makeCounts());

        expect(data.stations[1]).toEqual({
            terminal: '000002',
            name: 'Second Street',
            position: [-0.2, 51.6],
            docks: 30,
            source: 'current list'
        });
        expect(data.start).toBe('2024-07-01T00:00:00');
        expect(data.binMinutes).toBe(10);
    });

    it('rejects counts of the wrong size', () => {
        expect(() => parseHeartbeat(makeMetadata(), makeCounts(DEPARTURES))).toThrow(/expected 24/);
    });

    it.each([
        ['not an object', null],
        ['missing start', makeMetadata({ start: undefined })],
        ['zero bins', makeMetadata({ binCount: 0 })],
        ['wrong dtype', makeMetadata({ counts: { ...makeMetadata().counts, dtype: 'uint8' } })],
        ['wrong shape', makeMetadata({ counts: { ...makeMetadata().counts, shape: [3, 2] } })],
        ['station count mismatch', makeMetadata({ stationCount: 3 })]
    ])('rejects metadata with %s', (_label, metadata) => {
        expect(() => parseHeartbeat(metadata, makeCounts())).toThrow();
    });

    it('names the malformed station', () => {
        const metadata = makeMetadata();
        metadata.stations[1] = { ...metadata.stations[1], position: [-0.2] as never };

        expect(() => parseHeartbeat(metadata, makeCounts())).toThrow(/station 1/);
    });
});

describe('parseHeartbeatPeriod', () => {
    it('reads the period alone', () => {
        expect(parseHeartbeatPeriod(makeMetadata())).toEqual({
            start: '2024-07-01T00:00:00',
            binMinutes: 10,
            binCount: 3
        });
    });

    it('rejects an invalid period', () => {
        expect(() => parseHeartbeatPeriod(makeMetadata({ binMinutes: -10 }))).toThrow();
    });
});

describe('loadHeartbeat', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('fetches the metadata, then the counts file it names', async () => {
        const metadata = makeMetadata({
            counts: { ...makeMetadata().counts, file: 'other.bin' }
        });
        const fetchMock = vi.fn(async (url: string) =>
            url.endsWith('.json')
                ? new Response(JSON.stringify(metadata))
                : new Response(makeCounts())
        );
        vi.stubGlobal('fetch', fetchMock);

        const data = await loadHeartbeat('/base');

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/base/stations.json',
            '/base/other.bin'
        ]);
        expect(data.stations).toHaveLength(2);
    });

    it('throws when a file is missing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('Not found', { status: 404 }))
        );

        await expect(loadHeartbeat('/base')).rejects.toThrow(/404/);
    });
});

describe('loadHeartbeatPeriod', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('fetches only the metadata file', async () => {
        const fetchMock = vi.fn(
            async (_url: string) => new Response(JSON.stringify(makeMetadata()))
        );
        vi.stubGlobal('fetch', fetchMock);

        const period = await loadHeartbeatPeriod('/base');

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/base/stations.json']);
        expect(period.binCount).toBe(3);
    });
});

describe('generated heartbeat files', () => {
    // Checks the committed export still matches what this loader expects
    const dir = fileURLToPath(new URL('../../../public/data/heartbeat/', import.meta.url));
    const metadata: unknown = JSON.parse(readFileSync(`${dir}stations.json`, 'utf8'));
    const bytes = readFileSync(`${dir}counts.bin`);
    const counts = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    it('parses', () => {
        const data = parseHeartbeat(metadata, counts);

        expect(data.binCount).toBe(14 * 24 * 6);
        expect(data.stations.length).toBeGreaterThan(700);
    });

    it('has as many departures as cleaned journeys starting in the fortnight', () => {
        const data = parseHeartbeat(metadata, counts);
        const total = data.departures.reduce((sum, value) => sum + value, 0);

        // Matches the Python pipeline's count
        expect(total).toBe(357_228);
    });
});
