import { legendEntries, WALL_SUBTITLE, WALL_TITLE } from '../lib/wall-labels';

type Props = {
    // The moment being shown; omitted until the data has loaded
    clock?: { date: string; time: string };
};

// The /explore page's title, clock and colour key, in one panel in the top-left
// corner. Sized for laptops and phones rather than the wall.
export function ExploreOverlay({ clock }: Props) {
    return (
        <div className="pointer-events-none absolute top-3 left-3 max-w-[calc(100%-1.5rem)] rounded-xl bg-zinc-950/80 p-4 text-zinc-100 shadow-xl backdrop-blur sm:top-5 sm:left-5 sm:p-5">
            <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">{WALL_TITLE}</h1>
            <p className="mt-1 text-xs text-zinc-400 sm:text-sm">{WALL_SUBTITLE}</p>
            {clock ? (
                <p className="mt-3 flex items-baseline gap-3">
                    {/* Fixed-width digits stop the time jittering as it changes */}
                    <span className="text-4xl font-semibold tabular-nums sm:text-5xl">
                        {clock.time}
                    </span>
                    <span className="text-lg text-zinc-300 sm:text-xl">{clock.date}</span>
                </p>
            ) : null}
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-300 sm:text-sm">
                {legendEntries().map((entry) => (
                    <li key={entry.label} className="flex items-center gap-1.5">
                        <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: entry.color }}
                        />
                        {entry.label}
                    </li>
                ))}
                <li className="text-zinc-400">Bigger dot: more journeys</li>
            </ul>
        </div>
    );
}
