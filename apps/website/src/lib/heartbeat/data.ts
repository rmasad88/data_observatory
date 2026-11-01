// Loads the station heartbeat produced by `analysis/build_heartbeat.py` (see the
// README's "Generated data" section for the file format).

const HEARTBEAT_DIR = '/data/heartbeat';
const METADATA_FILE = 'stations.json';
const COUNTS_DTYPE = 'uint16-le';
const COUNT_BLOCKS = ['departures', 'arrivals'];

export type HeartbeatStation = {
    terminal: string;
    name: string;
    // [longitude, latitude], the order deck.gl expects
    position: [number, number];
    docks: number;
    // Which station list the location came from (2024 snapshot or current)
    source: string;
};

export type HeartbeatData = {
    // Start of the first bin in London local time, e.g. "2024-07-01T00:00:00".
    // Kept as text and only used for labels: playback works in minutes since
    // the start, so the viewer's timezone never matters.
    start: string;
    binMinutes: number;
    binCount: number;
    stations: HeartbeatStation[];
    // Counts per station per bin, flattened with one station's bins together.
    // Use `countIndex` to find a value.
    departures: Uint16Array;
    arrivals: Uint16Array;
};

// Position of (station, bin) in the flattened count arrays.
export function countIndex(data: HeartbeatData, station: number, bin: number) {
    return station * data.binCount + bin;
}

// Validate the metadata and wrap the count bytes. Throws with a specific
// message if anything doesn't match, so a stale or corrupt export fails loudly.
export function parseHeartbeat(metadata: unknown, counts: ArrayBuffer): HeartbeatData {
    if (!isRecord(metadata)) throw new Error('Heartbeat metadata is not an object');
    const { start, binMinutes, binCount, stationCount, stations } = metadata;
    const layout = metadata.counts;

    if (typeof start !== 'string') throw new Error('Heartbeat start is missing');
    if (!isPositiveInteger(binMinutes)) throw new Error('Invalid binMinutes');
    if (!isPositiveInteger(binCount)) throw new Error('Invalid binCount');
    if (!isPositiveInteger(stationCount)) throw new Error('Invalid stationCount');

    if (
        !isRecord(layout) ||
        layout.dtype !== COUNTS_DTYPE ||
        !sameArray(layout.blocks, COUNT_BLOCKS) ||
        !sameArray(layout.shape, [stationCount, binCount])
    ) {
        throw new Error('Heartbeat counts layout is not the expected format');
    }

    if (!Array.isArray(stations) || stations.length !== stationCount) {
        throw new Error('Heartbeat station list does not match stationCount');
    }
    const parsedStations = stations.map(parseStation);

    // Two blocks (departures, arrivals) of stations x bins, 2 bytes each
    const valuesPerBlock = stationCount * binCount;
    const expectedBytes = COUNT_BLOCKS.length * valuesPerBlock * Uint16Array.BYTES_PER_ELEMENT;
    if (counts.byteLength !== expectedBytes) {
        throw new Error(
            `Heartbeat counts are ${counts.byteLength} bytes, expected ${expectedBytes}`
        );
    }

    // Views into the downloaded buffer rather than copies. Uint16Array uses the
    // machine's byte order, which is little-endian on all mainstream hardware.
    return {
        start,
        binMinutes,
        binCount,
        stations: parsedStations,
        departures: new Uint16Array(counts, 0, valuesPerBlock),
        arrivals: new Uint16Array(
            counts,
            valuesPerBlock * Uint16Array.BYTES_PER_ELEMENT,
            valuesPerBlock
        )
    };
}

// Fetch both files and parse them. Throws on network or format errors; the
// caller decides how to report and retry.
export async function loadHeartbeat(baseUrl = HEARTBEAT_DIR): Promise<HeartbeatData> {
    const metadataResponse = await fetch(`${baseUrl}/${METADATA_FILE}`);
    if (!metadataResponse.ok) {
        throw new Error(`Failed to load heartbeat metadata: ${metadataResponse.status}`);
    }
    const metadata: unknown = await metadataResponse.json();

    // The counts file name comes from the metadata, so the two always match
    const countsFile =
        isRecord(metadata) && isRecord(metadata.counts) ? metadata.counts.file : undefined;
    if (typeof countsFile !== 'string') {
        throw new Error('Heartbeat metadata does not name its counts file');
    }
    const countsResponse = await fetch(`${baseUrl}/${countsFile}`);
    if (!countsResponse.ok) {
        throw new Error(`Failed to load heartbeat counts: ${countsResponse.status}`);
    }

    return parseHeartbeat(metadata, await countsResponse.arrayBuffer());
}

function parseStation(value: unknown, index: number): HeartbeatStation {
    if (
        isRecord(value) &&
        typeof value.terminal === 'string' &&
        typeof value.name === 'string' &&
        Array.isArray(value.position) &&
        value.position.length === 2 &&
        typeof value.position[0] === 'number' &&
        typeof value.position[1] === 'number' &&
        typeof value.docks === 'number' &&
        typeof value.source === 'string'
    ) {
        return {
            terminal: value.terminal,
            name: value.name,
            // Fresh tuple so we don't keep a reference into the parsed JSON
            position: [value.position[0], value.position[1]],
            docks: value.docks,
            source: value.source
        };
    }
    throw new Error(`Heartbeat station ${index} is malformed`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function sameArray(value: unknown, expected: readonly unknown[]) {
    return (
        Array.isArray(value) &&
        value.length === expected.length &&
        value.every((item, i) => item === expected[i])
    );
}
