import { describe, expect, it } from 'vite-plus/test';

import { COLOR_GAINING, COLOR_LOSING } from './heartbeat/layer';
import { legendEntries, labelTiles, wallClock } from './wall-labels';
import type { WallSize } from './wall-view';

const screen = { screenWidth: 1920, screenHeight: 1080 };
const SIMULATOR_WALL: WallSize = { cols: 3, rows: 2, ...screen };
const DO_WALL: WallSize = { cols: 16, rows: 4, ...screen };

describe('labelTiles', () => {
    it.each([
        ['simulator', SIMULATOR_WALL, 1],
        ['Data Observatory', DO_WALL, 3]
    ])(
        'puts the heading top left and the legend bottom left on the %s wall',
        (_name, wall, last) => {
            expect(labelTiles(wall)).toEqual({
                heading: { c: 0, r: 0 },
                legend: { c: 0, r: last }
            });
        }
    );
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
