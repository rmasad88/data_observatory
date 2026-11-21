// Loads the estimated journey paths produced by `analysis/build_paths.py` (see
// the README's "Journey paths" section for the file format): an index,
// `paths.json`, and one binary file per day.

// Under the site's base path, so the files are found when it is served from a
// sub-path such as GitHub Pages
const PATHS_DIR = `${import.meta.env.BASE_URL}data/paths`;
const INDEX_FILE = 'paths.json';

export type PathsDayEntry = {
    date: string;
    file: string;
    routes: number;
    points: number;
    journeys: number;
};

export type PathsIndex = {
    // The time journey starts are counted from, e.g. "2024-07-01T00:00:00"
    start: string;
    // [west, south, east, north] box the coordinates are stored across
    bounds: [number, number, number, number];
    // Coordinates are stored as whole steps from 0 to this across the box
    coordinateSteps: number;
    days: PathsDayEntry[];
};

// One day's routes and the journeys that start on it
export type PathDay = {
    date: string;
    // Where each route's points start in `positions` (counted in points), with
    // one extra entry marking the end of the last route
    routeOffsets: Uint32Array;
    // Every route's points as longitude, latitude pairs, one route after another
    positions: Float32Array;
    // Per journey, sorted by start: its route, start (seconds since the
    // index's start) and duration (seconds)
    journeyRoute: Uint32Array;
    journeyStart: Uint32Array;
    journeyDuration: Uint16Array;
};

export function parsePathsIndex(value: unknown): PathsIndex {
    if (!isRecord(value)) throw new Error('Paths index is not an object');
    const { start, bounds, coordinateSteps, days } = value;
    if (typeof start !== 'string') throw new Error('Paths start is missing');
    if (
        !Array.isArray(bounds) ||
        bounds.length !== 4 ||
        !bounds.every((bound) => typeof bound === 'number')
    ) {
        throw new Error('Paths bounds are invalid');
    }
    if (!isPositiveInteger(coordinateSteps)) throw new Error('Invalid coordinateSteps');
    if (!Array.isArray(days) || days.length === 0) throw new Error('Paths index lists no days');
    return {
        start,
        bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
        coordinateSteps,
        days: days.map(parseDayEntry)
    };
}

// Read one day's file, checking its size against the index so a stale or
// corrupt export fails loudly
export function parsePathDay(
    index: PathsIndex,
    entry: PathsDayEntry,
    buffer: ArrayBuffer
): PathDay {
    const { routes, points, journeys } = entry;
    const u32 = Uint32Array.BYTES_PER_ELEMENT;
    const u16 = Uint16Array.BYTES_PER_ELEMENT;
    const expectedBytes =
        (routes + 1) * u32 + 2 * journeys * u32 + journeys * u16 + 2 * points * u16;
    if (buffer.byteLength !== expectedBytes) {
        throw new Error(
            `Paths for ${entry.date} are ${buffer.byteLength} bytes, expected ${expectedBytes}`
        );
    }

    // Views into the downloaded buffer, in the file's order. Typed arrays use
    // the machine's byte order, which is little-endian on mainstream hardware.
    let offset = 0;
    const take = <T>(make: (start: number) => T, bytes: number) => {
        const view = make(offset);
        offset += bytes;
        return view;
    };
    const routeOffsets = take((at) => new Uint32Array(buffer, at, routes + 1), (routes + 1) * u32);
    const journeyRoute = take((at) => new Uint32Array(buffer, at, journeys), journeys * u32);
    const journeyStart = take((at) => new Uint32Array(buffer, at, journeys), journeys * u32);
    const journeyDuration = take((at) => new Uint16Array(buffer, at, journeys), journeys * u16);
    const steps = new Uint16Array(buffer, offset, 2 * points);

    return {
        date: entry.date,
        routeOffsets,
        positions: dequantise(index, steps),
        journeyRoute,
        journeyStart,
        journeyDuration
    };
}

// Stored steps back to longitude, latitude pairs
export function dequantise(index: PathsIndex, steps: Uint16Array): Float32Array {
    const [west, south, east, north] = index.bounds;
    const xScale = (east - west) / index.coordinateSteps;
    const yScale = (north - south) / index.coordinateSteps;
    const positions = new Float32Array(steps.length);
    for (let i = 0; i < steps.length; i += 2) {
        positions[i] = west + steps[i] * xScale;
        positions[i + 1] = south + steps[i + 1] * yScale;
    }
    return positions;
}

export async function loadPathsIndex(baseUrl = PATHS_DIR): Promise<PathsIndex> {
    const response = await fetch(`${baseUrl}/${INDEX_FILE}`);
    if (!response.ok) throw new Error(`Failed to load the paths index: ${response.status}`);
    return parsePathsIndex(await response.json());
}

// Fetch and read the day at a position in the index
export async function loadPathDay(
    index: PathsIndex,
    day: number,
    baseUrl = PATHS_DIR
): Promise<PathDay> {
    const entry = index.days[day];
    const response = await fetch(`${baseUrl}/${entry.file}`);
    if (!response.ok) {
        throw new Error(`Failed to load the paths for ${entry.date}: ${response.status}`);
    }
    return parsePathDay(index, entry, await response.arrayBuffer());
}

function parseDayEntry(value: unknown, position: number): PathsDayEntry {
    if (
        isRecord(value) &&
        typeof value.date === 'string' &&
        typeof value.file === 'string' &&
        isPositiveInteger(value.routes) &&
        isPositiveInteger(value.points) &&
        isPositiveInteger(value.journeys)
    ) {
        return {
            date: value.date,
            file: value.file,
            routes: value.routes,
            points: value.points,
            journeys: value.journeys
        };
    }
    throw new Error(`Paths day ${position} is malformed`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
