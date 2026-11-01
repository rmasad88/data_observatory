// Camera framing for the whole wall of screens.

import { WebMercatorViewport } from '@deck.gl/core';

import type { ScreenMapViewState } from './realtime/types';

export type WallSize = {
    cols: number;
    rows: number;
    // Pixel size of each screen
    screenWidth: number;
    screenHeight: number;
};

// The simulator's wall, used when a screen's URL doesn't give the wall's size
export const DEFAULT_WALL_COLS = 3;
export const DEFAULT_WALL_ROWS = 2;
// Screen size before the window can be measured (e.g. while rendering on the server)
export const DEFAULT_SCREEN_WIDTH = 1920;
export const DEFAULT_SCREEN_HEIGHT = 1080;
// Larger than any real wall; rejects mistyped URLs
const MAX_WALL_SCREENS_PER_SIDE = 64;

// The wall's layout for a screen: columns and rows from its URL
// (`?cols=16&rows=4` on the Data Observatory, `?cols=1&rows=1` to see the whole
// picture on one screen), and the pixel size of the window it runs in
export function wallSizeFrom(
    search: Record<string, unknown>,
    screen: { width: number; height: number }
): WallSize {
    return {
        cols: parseScreenCount(search.cols, DEFAULT_WALL_COLS),
        rows: parseScreenCount(search.rows, DEFAULT_WALL_ROWS),
        screenWidth: screen.width,
        screenHeight: screen.height
    };
}

// A whole number of screens from 1 to the maximum, or the fallback if missing
// or invalid. Router search values may arrive as numbers or strings.
function parseScreenCount(value: unknown, fallback: number) {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_WALL_SCREENS_PER_SIDE
        ? parsed
        : fallback;
}

// Space left around the stations, as a fraction of the wall's shorter side, so
// edge stations aren't cut off at the wall's border
const FIT_PADDING_FRACTION = 0.05;

// The camera that fits every position onto the whole wall. Each screen then
// shifts this shared view to show its own tile (see `deriveScreenMapView`).
export function fitPositionsToWall(
    positions: ReadonlyArray<readonly [number, number]>,
    wall: WallSize
): ScreenMapViewState {
    if (positions.length === 0) {
        throw new Error('Cannot fit the wall to an empty list of positions');
    }

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of positions) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    }

    const width = wall.cols * wall.screenWidth;
    const height = wall.rows * wall.screenHeight;
    const viewport = new WebMercatorViewport({ width, height }).fitBounds(
        [
            [minLon, minLat],
            [maxLon, maxLat]
        ],
        { padding: Math.round(Math.min(width, height) * FIT_PADDING_FRACTION) }
    );

    return {
        longitude: viewport.longitude,
        latitude: viewport.latitude,
        zoom: viewport.zoom,
        bearing: 0,
        pitch: 0
    };
}
