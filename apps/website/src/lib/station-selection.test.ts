import { describe, expect, it } from 'vite-plus/test';

import {
    addStationsInBox,
    clickStation,
    NO_SELECTION,
    selectionInPaths,
    selectionLabel,
    toggleStation
} from './station-selection';

describe('clickStation', () => {
    it('selects only the station clicked', () => {
        expect([...clickStation(new Set([1, 2]), 3)]).toEqual([3]);
    });

    it('clears the selection when the only selected station is clicked again', () => {
        expect(clickStation(new Set([3]), 3)).toBe(NO_SELECTION);
    });
});

describe('toggleStation', () => {
    it('adds a station, or removes one already selected', () => {
        expect([...toggleStation(new Set([1]), 2)]).toEqual([1, 2]);
        expect([...toggleStation(new Set([1, 2]), 1)]).toEqual([2]);
    });

    it('leaves the original selection unchanged', () => {
        const selection = new Set([1]);

        toggleStation(selection, 2);

        expect([...selection]).toEqual([1]);
    });
});

describe('addStationsInBox', () => {
    // Positions used directly as pixels
    const positions: [number, number][] = [
        [10, 10],
        [50, 50],
        [90, 10]
    ];
    const project = (position: [number, number]) => position;

    it('adds the stations inside the box to the selection', () => {
        const box = { x0: 0, y0: 0, x1: 60, y1: 60 };

        expect([...addStationsInBox(new Set([2]), positions, project, box)]).toEqual([2, 0, 1]);
    });

    it('accepts a box drawn in any direction', () => {
        const box = { x0: 100, y0: 20, x1: 40, y1: 0 };

        expect([...addStationsInBox(NO_SELECTION, positions, project, box)]).toEqual([2]);
    });
});

describe('selectionInPaths', () => {
    it('finds the selected stations in the paths terminal list', () => {
        const stationTerminals = ['A', 'B', 'C'];
        // C has no routes; the paths list terminals in their own order
        const pathTerminals = ['B', 'A'];

        expect([...selectionInPaths(new Set([0, 2]), stationTerminals, pathTerminals)]).toEqual([
            1
        ]);
    });
});

describe('selectionLabel', () => {
    it('names a single station and counts several', () => {
        const names = ['Hyde Park Corner', 'Soho Square'];

        expect(selectionLabel(new Set([0]), names)).toBe('Hyde Park Corner');
        expect(selectionLabel(new Set([0, 1]), names)).toBe('2 stations');
    });
});
