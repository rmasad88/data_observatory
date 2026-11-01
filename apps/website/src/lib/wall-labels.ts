// What the wall's labels say and which screen shows each one. Kept free of
// React so the rules can be unit-tested.

import { COLOR_BALANCED, COLOR_GAINING, COLOR_LOSING, type RGB } from './heartbeat/layer';
import { formatDataTime } from './playback';
import type { WallSize } from './wall-view';

export const WALL_TITLE = "London's cycling heartbeat";
export const WALL_SUBTITLE = 'Santander Cycles journeys, 1–14 July 2024 · TfL open data';

export type TilePosition = { c: number; r: number };

// Each label sits wholly on one screen, so no text is split across the bezels
// between screens: the heading top left, the legend bottom left
export function labelTiles(wall: WallSize): { heading: TilePosition; legend: TilePosition } {
    return {
        heading: { c: 0, r: 0 },
        legend: { c: 0, r: wall.rows - 1 }
    };
}

// The moment being shown, split for display: a large time and a smaller date,
// e.g. { time: "08:30", date: "Wed 10 Jul" }
export function wallClock(start: string, minutes: number) {
    const label = formatDataTime(start, minutes);
    const split = label.lastIndexOf(' ');
    return { date: label.slice(0, split), time: label.slice(split + 1) };
}

export type LegendEntry = { label: string; color: string };

// The net-flow colours, taken from the colours the dots are drawn with
export function legendEntries(): LegendEntry[] {
    return [
        { label: 'Losing bikes: more departures', color: cssColor(COLOR_LOSING) },
        { label: 'Balanced', color: cssColor(COLOR_BALANCED) },
        { label: 'Gaining bikes: more arrivals', color: cssColor(COLOR_GAINING) }
    ];
}

function cssColor([r, g, b]: RGB) {
    return `rgb(${r}, ${g}, ${b})`;
}
