import { WebMercatorViewport } from '@deck.gl/core';
import { describe, expect, it } from 'vite-plus/test';

import { fitPositionsToWall, wallSizeFrom, type WallSize } from './wall-view';

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

describe('wallSizeFrom', () => {
    const screen = { width: 1920, height: 1080 };

    it('reads the wall size from the URL', () => {
        expect(wallSizeFrom({ cols: '16', rows: '4' }, screen)).toEqual(DO_WALL);
        // The router may already have turned them into numbers
        expect(wallSizeFrom({ cols: 1, rows: 1 }, screen)).toMatchObject({ cols: 1, rows: 1 });
    });

    it("defaults to the simulator's wall", () => {
        expect(wallSizeFrom({}, screen)).toEqual(SIMULATOR_WALL);
    });

    it.each([['0'], ['-2'], ['1.5'], ['wide'], ['65']])('ignores %s screens', (value) => {
        expect(wallSizeFrom({ cols: value, rows: value }, screen)).toEqual(SIMULATOR_WALL);
    });

    it("uses the window's size for each screen", () => {
        expect(wallSizeFrom({}, { width: 1280, height: 720 })).toMatchObject({
            screenWidth: 1280,
            screenHeight: 720
        });
    });
});
