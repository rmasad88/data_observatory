import { describe, expect, it } from 'vite-plus/test';

import { COLOR_GAINING, COLOR_LOSING } from './heartbeat/layer';
import { labelSizes, legendEntries, wallClock } from './wall-labels';
import type { WallSize } from './wall-view';

const screen = { screenWidth: 1920, screenHeight: 1080 };
const SIMULATOR_WALL: WallSize = { cols: 3, rows: 2, ...screen };
const DO_WALL: WallSize = { cols: 16, rows: 4, ...screen };

describe('labelSizes', () => {
    it('makes the title and clock 20% of screen height on the Data Observatory', () => {
        const sizes = labelSizes(DO_WALL);

        expect(sizes.title).toBeCloseTo(216);
        expect(sizes.clock).toBeCloseTo(216);
        expect(sizes.body).toBeCloseTo(54);
    });

    it('scales down in proportion on a wall with fewer rows', () => {
        // Half size on the simulator's 2 rows, a quarter on a single screen
        expect(labelSizes(SIMULATOR_WALL).clock).toBeCloseTo(108);
        expect(labelSizes({ ...SIMULATOR_WALL, cols: 1, rows: 1 }).clock).toBeCloseTo(54);
    });

    it('shrinks only the title to fit a narrow wall', () => {
        // One screen wide but full height, so the full-size title wouldn't fit
        const narrow: WallSize = { cols: 1, rows: 4, ...screen };
        const sizes = labelSizes(narrow);

        expect(sizes.title).toBeLessThan(216);
        // The estimated title width fits between the margins and padding
        expect(sizes.title * 14 + 2 * (sizes.margin + sizes.padding)).toBeLessThanOrEqual(1920);
        expect(sizes.clock).toBeCloseTo(216);
    });

    it('scales with the screen height', () => {
        const small: WallSize = { ...DO_WALL, screenWidth: 1280, screenHeight: 720 };

        expect(labelSizes(small).clock).toBeCloseTo(144);
    });
});

describe('wallClock', () => {
    it('splits the moment into a time and a date', () => {
        // Wednesday 10 July 08:30
        expect(wallClock('2024-07-01T00:00:00', (9 * 24 + 8.5) * 60)).toEqual({
            date: 'Wed 10 Jul',
            time: '08:30'
        });
    });
});

describe('legendEntries', () => {
    it('uses the colours the dots are drawn with', () => {
        const colors = legendEntries().map((entry) => entry.color);

        expect(colors).toContain(`rgb(${COLOR_LOSING.join(', ')})`);
        expect(colors).toContain(`rgb(${COLOR_GAINING.join(', ')})`);
    });
});
