// What the wall's labels say and how big they are. Kept free of React so the
// rules can be unit-tested.

import { COLOR_BALANCED, COLOR_GAINING, COLOR_LOSING, type RGB } from './heartbeat/layer';
import { formatDataTime } from './playback';
import type { WallSize } from './wall-view';

export const WALL_TITLE = "London's cycling heartbeat";
export const WALL_SUBTITLE = 'Santander Cycles journeys, 1–14 July 2024 · TfL open data';

// Text sizes as fractions of one screen's height, so labels scale with the
// wall. The starter's guidelines (BEST_PRACTICES.md, section 6) ask for primary
// wall text of at least 20% of screen height, for viewing from up to ~10 m.
const PRIMARY_TEXT_FRACTION = 0.2;
const DATE_TEXT_FRACTION = 0.1;
const SECONDARY_TEXT_FRACTION = 0.05;
// Gap from the wall's edges, and padding inside the label panels
const MARGIN_FRACTION = 0.04;
const PADDING_FRACTION = 0.03;
// The Data Observatory's rows. Smaller walls, like the 3 × 2 simulator, scale
// the labels down in proportion, so they preview how much of the real wall
// the labels cover rather than filling a small wall.
const FULL_SIZE_WALL_ROWS = 4;
// The title's width in multiples of its font size, estimated generously for
// the app's semibold sans-serif. Used to shrink the title on narrow walls.
const TITLE_WIDTH_EMS = 14;

export type LabelSizes = {
    // Font sizes in pixels
    title: number;
    clock: number;
    date: number;
    body: number;
    // Spacing in pixels
    margin: number;
    padding: number;
};

// Label sizes for a wall. The title and clock are primary text. On a wall with
// fewer rows than the Data Observatory everything shrinks in proportion (half
// size on the simulator's 2 rows). The title runs along the wall's top row,
// across screen bezels, and also shrinks if the wall is too narrow for it.
export function labelSizes(wall: WallSize): LabelSizes {
    const height = wall.screenHeight * Math.min(1, wall.rows / FULL_SIZE_WALL_ROWS);
    const margin = MARGIN_FRACTION * height;
    const padding = PADDING_FRACTION * height;
    const primary = PRIMARY_TEXT_FRACTION * height;
    const titleRoom = wall.cols * wall.screenWidth - 2 * (margin + padding);
    return {
        title: Math.min(primary, titleRoom / TITLE_WIDTH_EMS),
        clock: primary,
        date: DATE_TEXT_FRACTION * height,
        body: SECONDARY_TEXT_FRACTION * height,
        margin,
        padding
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
