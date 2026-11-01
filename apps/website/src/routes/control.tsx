import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { Button } from '../components/button';
import { formatDataTime, playbackMinutes, wrapMinutes } from '../lib/playback';
import { controlEngine } from '../lib/realtime/engines/control-engine';
import { useControlStore } from '../lib/realtime/stores/control-store';

// Speeds an operator can pick, in simulated minutes per real second
const SPEED_PRESETS = [
    { label: '½ day/min', speed: 12 },
    { label: '1 day/min', speed: 24 },
    { label: '2 days/min', speed: 48 },
    { label: '5 days/min', speed: 120 }
];
// How often the time label refreshes; plenty for a clock showing minutes
const CLOCK_REFRESH_MS = 100;

type ControlSearch = {
    // Optional label so multiple control clients can be distinguished in the simulator.
    operator: string;
};

export const Route = createFileRoute('/control')({
    validateSearch: (search: Record<string, unknown>): ControlSearch => {
        return {
            // Default operator id keeps the route usable when query params are omitted.
            operator: typeof search.operator === 'string' ? search.operator : 'A'
        };
    },
    component: ControlPage
});

function ControlPage() {
    // `/control` models a handheld/operator endpoint:
    // - it sends intent into the websocket bus
    // - it does not render the heavy map visuals itself
    // This separation mirrors operational setups where controllers and wall screens have
    // different hardware constraints and UX goals.
    const { operator } = Route.useSearch();
    const connection = useControlStore((state) => state.connection);
    const playback = useControlStore((state) => state.playback);
    const timeLabel = usePlaybackLabel();

    // Also the retry path if the dates failed to load earlier
    useEffect(() => {
        void controlEngine.ensurePeriodLoaded();
    }, []);

    return (
        <main className="h-screen w-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
            <div className="flex h-full w-full flex-col p-3">
                <header className="mb-3 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <div>
                        <p className="text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                            Operator
                        </p>
                        <h1 className="text-sm font-semibold">Control Panel {operator}</h1>
                    </div>
                    <span className="rounded-full bg-[var(--primary)] px-2 py-1 text-[10px] font-medium text-[var(--primary-foreground)]">
                        /control
                    </span>
                </header>

                <section className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
                    <div>
                        <p className="text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                            Wall time
                        </p>
                        <p className="text-2xl font-semibold tabular-nums">{timeLabel}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                            {playback
                                ? playback.playing
                                    ? `Playing at ${speedLabel(playback.speed)}`
                                    : 'Paused'
                                : 'Waiting for the wall'}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            disabled={!playback}
                            variant={playback?.playing ? 'highlight' : 'normal'}
                            onClick={() =>
                                controlEngine.setPlayback({ playing: !playback?.playing })
                            }
                        >
                            {playback?.playing ? 'Pause' : 'Play'}
                        </Button>
                        <Button
                            disabled={!playback}
                            // Back to the start of the data, keeping play/pause as it is
                            onClick={() => controlEngine.setPlayback({ positionMinutes: 0 })}
                        >
                            Restart
                        </Button>
                    </div>

                    <div>
                        <p className="mb-1 text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                            Speed
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {SPEED_PRESETS.map((preset) => (
                                <Button
                                    key={preset.speed}
                                    disabled={!playback}
                                    variant={
                                        playback?.speed === preset.speed ? 'highlight' : 'normal'
                                    }
                                    onClick={() =>
                                        controlEngine.setPlayback({ speed: preset.speed })
                                    }
                                >
                                    {preset.label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <p className="text-xs text-[var(--muted-foreground)]">
                        Bus connection: {connection}
                    </p>
                </section>
            </div>
        </main>
    );
}

// The wall's current time as a label, refreshed while playing
function usePlaybackLabel() {
    const playback = useControlStore((state) => state.playback);
    const clockOffsetMs = useControlStore((state) => state.clockOffsetMs);
    const period = useControlStore((state) => state.period);
    const [label, setLabel] = useState('–');

    useEffect(() => {
        if (!playback || !period) return;
        const periodMinutes = period.binCount * period.binMinutes;
        const update = () => {
            const minutes = playbackMinutes(playback, Date.now() + clockOffsetMs);
            setLabel(formatDataTime(period.start, wrapMinutes(minutes, periodMinutes)));
        };

        update();
        if (!playback.playing) return;
        const timer = window.setInterval(update, CLOCK_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [playback, clockOffsetMs, period]);

    return label;
}

function speedLabel(speed: number) {
    const preset = SPEED_PRESETS.find((p) => p.speed === speed);
    return preset ? preset.label : `${speed} min/s`;
}
