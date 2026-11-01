import type { CSSProperties } from 'react';

import { labelSizes, legendEntries, WALL_SUBTITLE, WALL_TITLE } from '../lib/wall-labels';
import type { WallSize } from '../lib/wall-view';

// A dark panel keeps the text readable over the map and the dots
const PANEL_CLASS = 'absolute rounded-3xl bg-zinc-950/80 text-zinc-100 shadow-2xl';

type Props = {
    wall: WallSize;
    // This screen's column and row on the wall
    c: number;
    r: number;
    // The moment being shown; omitted until the data has loaded
    clock?: { date: string; time: string };
};

// The wall's labels, laid out once across the whole wall: the title and clock
// along the top left, the legend at the bottom left. Each screen draws the whole
// layer shifted by its own position and shows only its slice, like the map, so
// a label can run across the bezel between screens.
export function WallLabels({ wall, c, r, clock }: Props) {
    const sizes = labelSizes(wall);
    const panelStyle: CSSProperties = { padding: sizes.padding };
    const swatchSize = sizes.body * 0.8;

    return (
        <div
            className="absolute"
            style={{
                left: -c * wall.screenWidth,
                top: -r * wall.screenHeight,
                width: wall.cols * wall.screenWidth,
                height: wall.rows * wall.screenHeight
            }}
        >
            <div
                className={PANEL_CLASS}
                style={{ ...panelStyle, top: sizes.margin, left: sizes.margin }}
            >
                <h1
                    className="leading-none font-semibold tracking-tight whitespace-nowrap"
                    style={{ fontSize: sizes.title }}
                >
                    {WALL_TITLE}
                </h1>
                <p
                    className="text-zinc-400"
                    style={{ fontSize: sizes.body, marginTop: sizes.padding / 2 }}
                >
                    {WALL_SUBTITLE}
                </p>
                {clock ? (
                    <p
                        className="flex items-baseline leading-none"
                        style={{ gap: sizes.padding, marginTop: sizes.padding }}
                    >
                        {/* Fixed-width digits stop the time jittering as it changes */}
                        <span
                            className="font-semibold tabular-nums"
                            style={{ fontSize: sizes.clock }}
                        >
                            {clock.time}
                        </span>
                        <span className="text-zinc-300" style={{ fontSize: sizes.date }}>
                            {clock.date}
                        </span>
                    </p>
                ) : null}
            </div>

            <div
                className={PANEL_CLASS}
                style={{ ...panelStyle, bottom: sizes.margin, left: sizes.margin }}
            >
                <ul style={{ fontSize: sizes.body }}>
                    {legendEntries().map((entry) => (
                        <li
                            key={entry.label}
                            className="flex items-center"
                            style={{ gap: sizes.padding / 2 }}
                        >
                            <span
                                className="inline-block shrink-0 rounded-full"
                                style={{
                                    width: swatchSize,
                                    height: swatchSize,
                                    backgroundColor: entry.color
                                }}
                            />
                            {entry.label}
                        </li>
                    ))}
                </ul>
                <p
                    className="text-zinc-400"
                    style={{ fontSize: sizes.body, marginTop: sizes.padding / 2 }}
                >
                    Bigger dot: more journeys
                </p>
            </div>
        </div>
    );
}
