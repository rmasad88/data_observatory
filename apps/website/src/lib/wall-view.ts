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
