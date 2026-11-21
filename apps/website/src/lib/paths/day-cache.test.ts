import { describe, expect, it, vi } from 'vite-plus/test';

import { MINUTES_PER_DAY, PathDayCache, wantedDays } from './day-cache';
import type { DayTrips } from './trips';

const PERIOD = 14 * MINUTES_PER_DAY;

describe('wantedDays', () => {
    it('wants the current day and its neighbours, unshifted mid-period', () => {
        // Wednesday 3rd, midday
        expect(wantedDays(14, 2 * MINUTES_PER_DAY + 720)).toEqual([
            { day: 2, timeShift: 0 },
            { day: 1, timeShift: 0 },
            { day: 3, timeShift: 0 }
        ]);
    });

    it('draws the last day a period earlier on the first day', () => {
        expect(wantedDays(14, 10)).toEqual([
            { day: 0, timeShift: 0 },
            { day: 13, timeShift: PERIOD },
            { day: 1, timeShift: 0 }
        ]);
    });

    it('draws the first day a period later on the last day', () => {
        expect(wantedDays(14, PERIOD - 10)).toEqual([
            { day: 13, timeShift: 0 },
            { day: 12, timeShift: 0 },
            { day: 0, timeShift: -PERIOD }
        ]);
    });

    it('lists each day once in a short period', () => {
        expect(wantedDays(1, 10)).toEqual([{ day: 0, timeShift: 0 }]);
        expect(wantedDays(2, 10)).toEqual([
            { day: 0, timeShift: 0 },
            { day: 1, timeShift: 2 * MINUTES_PER_DAY }
        ]);
    });
});

// A loader whose days arrive only when the test says so
function deferredLoader() {
    const pending = new Map<
        number,
        { resolve: (trips: DayTrips) => void; reject: (error: unknown) => void }
    >();
    const load = vi.fn(
        (day: number) =>
            new Promise<DayTrips>((resolve, reject) => pending.set(day, { resolve, reject }))
    );
    const arrive = async (day: number) => {
        pending.get(day)?.resolve({ date: `day ${day}`, trips: [] });
        // Let the cache's handlers run
        await Promise.resolve();
    };
    const fail = async (day: number) => {
        pending.get(day)?.reject(new Error('offline'));
        await Promise.resolve();
    };
    return { load, arrive, fail };
}

describe('PathDayCache', () => {
    it('loads the days wanted and reports each as it arrives', async () => {
        const { load, arrive } = deferredLoader();
        const onChange = vi.fn();
        const cache = new PathDayCache(load, onChange);

        cache.want([2, 1, 3]);
        await arrive(1);

        expect(load.mock.calls.map(([day]) => day)).toEqual([2, 1, 3]);
        expect(cache.get(1)?.date).toBe('day 1');
        expect(cache.get(2)).toBeUndefined();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('loads each day once while it stays wanted', async () => {
        const { load, arrive } = deferredLoader();
        const cache = new PathDayCache(load, () => {});

        cache.want([2, 1]);
        cache.want([2, 1]);
        await arrive(2);
        cache.want([3, 2]);

        expect(load.mock.calls.map(([day]) => day)).toEqual([2, 1, 3]);
    });

    it('forgets days no longer wanted, including ones still loading', async () => {
        const { load, arrive } = deferredLoader();
        const onChange = vi.fn();
        const cache = new PathDayCache(load, onChange);

        cache.want([1, 2]);
        await arrive(1);
        cache.want([3]);
        await arrive(2);

        expect(cache.get(1)).toBeUndefined();
        expect(cache.get(2)).toBeUndefined();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('reports a failed day once and does not retry it', async () => {
        const { load, fail } = deferredLoader();
        const onError = vi.fn();
        const cache = new PathDayCache(load, () => {}, onError);

        cache.want([4]);
        await fail(4);
        cache.want([4]);

        expect(load).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(4, expect.any(Error));
    });

    it('stays quiet after being disposed', async () => {
        const { load, arrive } = deferredLoader();
        const onChange = vi.fn();
        const cache = new PathDayCache(load, onChange);

        cache.want([0]);
        cache.dispose();
        await arrive(0);

        expect(cache.get(0)).toBeUndefined();
        expect(onChange).not.toHaveBeenCalled();
    });
});
