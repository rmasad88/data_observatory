import { ArrowsInIcon, PathIcon, PauseIcon, PlayIcon, PlusMinusIcon } from '@phosphor-icons/react';

import type { DayTick } from '../lib/explore';
import { SPEED_PRESETS } from '../lib/playback';

type Props = {
    playing: boolean;
    speed: number;
    // Minutes since the data's start being shown, and the period's length
    minutes: number;
    periodMinutes: number;
    ticks: DayTick[];
    // Spoken by screen readers for the timeline, e.g. "Wed 10 Jul 08:30"
    timeLabel: string;
    onTogglePlay: () => void;
    onSeek: (minutes: number) => void;
    onSpeed: (speed: number) => void;
    onResetView: () => void;
    // Whether the journey trails and the + and − symbols are drawn
    showJourneys: boolean;
    showSymbols: boolean;
    onToggleJourneys: () => void;
    onToggleSymbols: () => void;
};

const BUTTON_CLASS =
    'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-zinc-800 text-zinc-100 hover:bg-zinc-700';
// A switched-off layer toggle: dimmer, with no fill
const TOGGLE_OFF_CLASS =
    'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-zinc-700 text-zinc-500 hover:text-zinc-300';
// The slider moves in 10-minute steps, one data bin
const SEEK_STEP_MINUTES = 10;

// The /explore page's playback bar: play/pause, a timeline across the period
// with a mark per day, speed and a button to re-frame the map
export function ExploreControls(props: Props) {
    const { playing, speed, minutes, periodMinutes, ticks, timeLabel } = props;

    return (
        // Clear of the map's attribution in the bottom-right corner
        <div className="absolute right-3 bottom-8 left-3 flex items-center gap-3 rounded-xl bg-zinc-950/80 p-3 text-zinc-100 shadow-xl backdrop-blur sm:right-5 sm:left-5">
            <button
                type="button"
                className={BUTTON_CLASS}
                onClick={props.onTogglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
                title={playing ? 'Pause (space)' : 'Play (space)'}
            >
                {playing ? (
                    <PauseIcon size={18} weight="fill" />
                ) : (
                    <PlayIcon size={18} weight="fill" />
                )}
            </button>

            <div className="relative min-w-0 flex-1 pb-5">
                <input
                    type="range"
                    className="w-full cursor-pointer accent-zinc-100"
                    min={0}
                    max={periodMinutes - SEEK_STEP_MINUTES}
                    step={SEEK_STEP_MINUTES}
                    value={minutes}
                    onChange={(event) => props.onSeek(Number(event.target.value))}
                    aria-label="Time"
                    aria-valuetext={timeLabel}
                />
                {ticks.map((tick) => (
                    <span
                        key={tick.minutes}
                        // Narrow screens label only Mondays, so the labels don't collide
                        className={`absolute bottom-0 -translate-x-1/2 text-[10px] whitespace-nowrap text-zinc-400 ${
                            tick.label.startsWith('Mon') ? '' : 'hidden md:inline'
                        }`}
                        style={{ left: `${(tick.minutes / periodMinutes) * 100}%` }}
                    >
                        {tick.label}
                    </span>
                ))}
            </div>

            <select
                className="h-9 shrink-0 cursor-pointer rounded-lg bg-zinc-800 px-2 text-sm text-zinc-100"
                value={speed}
                onChange={(event) => props.onSpeed(Number(event.target.value))}
                aria-label="Speed"
            >
                {SPEED_PRESETS.map((preset) => (
                    <option key={preset.speed} value={preset.speed}>
                        {preset.label}
                    </option>
                ))}
            </select>

            <LayerToggle
                label="Journeys"
                pressed={props.showJourneys}
                onToggle={props.onToggleJourneys}
            >
                <PathIcon size={18} />
            </LayerToggle>
            <LayerToggle
                label="+/− symbols"
                pressed={props.showSymbols}
                onToggle={props.onToggleSymbols}
            >
                <PlusMinusIcon size={18} />
            </LayerToggle>

            <button
                type="button"
                className={BUTTON_CLASS}
                onClick={props.onResetView}
                aria-label="Reset view"
                title="Reset view"
            >
                <ArrowsInIcon size={18} />
            </button>
        </div>
    );
}

type LayerToggleProps = {
    label: string;
    pressed: boolean;
    onToggle: () => void;
    children: React.ReactNode;
};

// An on/off button for one of the map's optional layers
function LayerToggle({ label, pressed, onToggle, children }: LayerToggleProps) {
    return (
        <button
            type="button"
            className={pressed ? BUTTON_CLASS : TOGGLE_OFF_CLASS}
            onClick={onToggle}
            aria-label={label}
            aria-pressed={pressed}
            title={`${label}: ${pressed ? 'on' : 'off'}`}
        >
            {children}
        </button>
    );
}
