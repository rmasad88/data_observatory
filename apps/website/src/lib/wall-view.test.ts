import { WebMercatorViewport } from '@deck.gl/core';
import { describe, expect, it } from 'vite-plus/test';

import { fitPositionsToWall, type WallSize } from './wall-view';

const SIMULATOR_WALL: WallSize = { cols: 3, rows: 2, screenWidth: 1920, screenHeight: 1080 };
const DO_WALL: WallSize = { cols: 16, rows: 4, screenWidth: 1920, screenHeight: 1080 };

// Corners of a box roughly the size of central London's station network
const LONDON_BOX: Array<[number, number]> = [
    [-0.236, 51.454],
    [-0.003, 51.549],
    [-0.236, 51.549],
    [-0.003, 51.454]
];

// Where each position lands in pixels on the whole wall
function wallPixels(positions: Array<[number, number]>, wall: WallSize) {
    const view = fitPositionsToWall(positions, wall);
    const viewport = new WebMercatorViewport({
        ...view,
        width: wall.cols * wall.screenWidth,
        height: wall.rows * wall.screenHeight
    });
    return positions.map((position) => viewport.project(position));
}

describe('fitPositionsToWall', () => {
    it.each([
        ['simulator', SIMULATOR_WALL],
        ['Data Observatory', DO_WALL]
    ])('puts every position on the %s wall', (_name, wall) => {
        const width = wall.cols * wall.screenWidth;
        const height = wall.rows * wall.screenHeight;

        for (const [x, y] of wallPixels(LONDON_BOX, wall)) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(width);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(height);
        }
    });

    it('centres the box on the wall', () => {
        const [[left], [right]] = wallPixels(LONDON_BOX, SIMULATOR_WALL);
        const wallWidth = SIMULATOR_WALL.cols * SIMULATOR_WALL.screenWidth;

        // The box's left and right edges are equally far from the wall's sides
        expect(left).toBeCloseTo(wallWidth - right, 0);
    });

    it('zooms in further on a bigger wall', () => {
        const simulator = fitPositionsToWall(LONDON_BOX, SIMULATOR_WALL);
        const observatory = fitPositionsToWall(LONDON_BOX, DO_WALL);

        // Zoom counts 512-pixel tiles, as in deck.gl and MapLibre: about 13.1 here
        expect(simulator.zoom).toBeCloseTo(13.1, 0);
        expect(observatory.zoom).toBeGreaterThan(simulator.zoom);
    });

    it('rejects an empty list', () => {
        expect(() => fitPositionsToWall([], SIMULATOR_WALL)).toThrow(/empty/);
    });
});
