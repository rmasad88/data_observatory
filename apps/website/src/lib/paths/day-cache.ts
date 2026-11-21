// Which days of journey paths to hold in memory, and holding them. A whole
// fortnight of trails is too much to keep at once, so only the day being shown
// is kept, with the day before (rides that started before midnight are still
// on the road) and the day after (loaded ahead, ready for midnight).

import type { DayTrips } from './trips';

export const MINUTES_PER_DAY = 24 * 60;

export type WantedDay = {
    // Position in the paths index
    day: number;
    // Added to the time shown before drawing this day, so the fortnight loops:
    // on the first day the last day is drawn a period earlier, and on the last
    // day the first is drawn a period later
    timeShift: number;
};

// The days needed at a moment (minutes since the data's start, within the
// period): the current day first, then the one before and the one after,
// wrapping round the period. Each day appears once, even in a short period.
export function wantedDays(dayCount: number, minutes: number): WantedDay[] {
    const period = dayCount * MINUTES_PER_DAY;
    const current = Math.min(Math.floor(minutes / MINUTES_PER_DAY), dayCount - 1);
    const candidates = [
        { day: current, timeShift: 0 },
        current === 0
            ? { day: dayCount - 1, timeShift: period }
            : { day: current - 1, timeShift: 0 },
        current === dayCount - 1
            ? { day: 0, timeShift: -period }
            : { day: current + 1, timeShift: 0 }
    ];
    return candidates.filter(
        (wanted, position) => candidates.findIndex((other) => other.day === wanted.day) === position
    );
}

export type DayLoader = (day: number) => Promise<DayTrips>;

// Loads the days asked for, keeps them until they are no longer wanted and
// says when one arrives. A day that fails to load is reported once and not
// tried again, so a missing file doesn't cause a request every frame.
export class PathDayCache {
    private readonly loaded = new Map<number, DayTrips>();
    private readonly loading = new Set<number>();
    private readonly failed = new Set<number>();
    private wanted = new Set<number>();
    private disposed = false;
    private readonly load: DayLoader;
    private readonly onChange: () => void;
    private readonly onError: (day: number, error: unknown) => void;

    constructor(
        load: DayLoader,
        onChange: () => void,
        onError: (day: number, error: unknown) => void = () => {}
    ) {
        this.load = load;
        this.onChange = onChange;
        this.onError = onError;
    }

    // Ask for exactly these days: start loading any missing ones and forget
    // the rest
    want(days: number[]) {
        this.wanted = new Set(days);
        for (const day of this.loaded.keys()) {
            if (!this.wanted.has(day)) this.loaded.delete(day);
        }
        for (const day of this.wanted) {
            if (!this.loaded.has(day) && !this.loading.has(day) && !this.failed.has(day)) {
                this.start(day);
            }
        }
    }

    get(day: number): DayTrips | undefined {
        return this.loaded.get(day);
    }

    // Stop reporting: anything still loading is dropped when it arrives
    dispose() {
        this.disposed = true;
        this.loaded.clear();
    }

    private start(day: number) {
        this.loading.add(day);
        this.load(day).then(
            (trips) => {
                this.loading.delete(day);
                // No longer needed by the time it arrived
                if (this.disposed || !this.wanted.has(day)) return;
                this.loaded.set(day, trips);
                this.onChange();
            },
            (error: unknown) => {
                this.loading.delete(day);
                this.failed.add(day);
                if (!this.disposed) this.onError(day, error);
            }
        );
    }
}
