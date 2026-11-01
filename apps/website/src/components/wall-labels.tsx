import { legendEntries, WALL_SUBTITLE, WALL_TITLE } from '../lib/wall-labels';

// Sized for a 1920×1080 screen viewed from a few metres away. A dark panel keeps
// the text readable over the map and the dots.
const PANEL_CLASS = 'rounded-3xl bg-zinc-950/80 px-12 py-10 text-zinc-100 shadow-2xl';

type HeadingProps = {
    // The moment being shown; omitted until the data has loaded
    clock?: { date: string; time: string };
};

// Title, data source and the wall's clock, for the top-left screen
export function WallHeading({ clock }: HeadingProps) {
    return (
        <div className={`${PANEL_CLASS} absolute top-16 left-16 max-w-[1100px]`}>
            <h2 className="text-7xl font-semibold tracking-tight">{WALL_TITLE}</h2>
            <p className="mt-4 text-3xl text-zinc-400">{WALL_SUBTITLE}</p>
            {clock ? (
                <p className="mt-10 flex items-baseline gap-8">
                    {/* Fixed-width digits stop the time jittering as it changes */}
                    <span className="text-9xl font-semibold tabular-nums">{clock.time}</span>
                    <span className="text-5xl text-zinc-300">{clock.date}</span>
                </p>
            ) : null}
        </div>
    );
}

// What the dots' colours and sizes mean, for the bottom-left screen
export function WallLegend() {
    return (
        <div className={`${PANEL_CLASS} absolute bottom-16 left-16`}>
            <ul className="space-y-5 text-4xl">
                {legendEntries().map((entry) => (
                    <li key={entry.label} className="flex items-center gap-6">
                        <span
                            className="inline-block h-10 w-10 rounded-full"
                            style={{ backgroundColor: entry.color }}
                        />
                        {entry.label}
                    </li>
                ))}
            </ul>
            <p className="mt-8 text-3xl text-zinc-400">Bigger dot: more journeys</p>
        </div>
    );
}
