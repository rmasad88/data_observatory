// React glue for the journey trails: loads the paths index once trails are
// first switched on, keeps the days around the moment shown in a
// PathDayCache, and gives back a trail layer per loaded day, limited to a
// selection of stations if one is given.

import { useEffect, useMemo, useState } from 'react';

import { NO_SELECTION, selectionInPaths, type Selection } from '../station-selection';
import { loadPathDay, loadPathsIndex, type PathsIndex } from './data';
import { MINUTES_PER_DAY, PathDayCache, wantedDays } from './day-cache';
import { buildDayTrips, createTripsLayer, filterTrips } from './trips';

export type TrailFilter = {
    // Stations (positions in the heartbeat's list) whose journeys to show;
    // empty for every journey
    selection: Selection;
    // The heartbeat's terminal for each station, to match them to the paths
    stationTerminals: string[];
};

const NO_FILTER: TrailFilter = { selection: NO_SELECTION, stationTerminals: [] };

// `minutes` is the time shown (since the data's start, within the period) and
// `start` the heartbeat's start, which the paths must share for their times to
// line up. Nothing is loaded while `enabled` is false. Keep `filter` the same
// object between renders unless it changes: a new one rebuilds the trails.
export function useJourneyTrails(
    enabled: boolean,
    start: string | undefined,
    minutes: number,
    filter: TrailFilter = NO_FILTER
) {
    const [index, setIndex] = useState<PathsIndex | null>(null);
    const [cache, setCache] = useState<PathDayCache | null>(null);
    // Bumped whenever a day arrives, so the layers are rebuilt
    const [version, setVersion] = useState(0);

    // The index, the first time trails are wanted
    const wantIndex = enabled && start !== undefined && index === null;
    useEffect(() => {
        if (!wantIndex) return;
        let cancelled = false;
        loadPathsIndex()
            .then((loaded) => {
                if (cancelled) return;
                if (loaded.start !== start) {
                    throw new Error(
                        `Paths start at ${loaded.start} but the heartbeat at ${start}; rebuild them`
                    );
                }
                setIndex(loaded);
            })
            .catch((error: unknown) => console.error('Journey trails unavailable:', error));
        return () => {
            cancelled = true;
        };
    }, [wantIndex, start]);

    // One cache per index, dropped with the page
    useEffect(() => {
        if (!index) return;
        const created = new PathDayCache(
            (day) => loadPathDay(index, day).then(buildDayTrips),
            () => setVersion((count) => count + 1),
            (day, error) =>
                console.error(`Journey trails for ${index.days[day].date} unavailable:`, error)
        );
        setCache(created);
        return () => created.dispose();
    }, [index]);

    // Only changes at midnight, so the cache is asked again once a day
    const day = Math.floor(minutes / MINUTES_PER_DAY);
    const wanted = useMemo(
        () => (index ? wantedDays(index.days.length, day * MINUTES_PER_DAY) : []),
        [index, day]
    );
    useEffect(() => {
        if (enabled && cache) cache.want(wanted.map((entry) => entry.day));
    }, [enabled, cache, wanted]);

    // The days' trips, filtered to the selection: only redone when a day
    // arrives or the selection changes, not every frame
    const shown = useMemo(() => {
        if (!enabled || !cache || !index) return [];
        const stations =
            filter.selection.size > 0
                ? selectionInPaths(filter.selection, filter.stationTerminals, index.terminals)
                : null;
        return wanted.flatMap(({ day: wantedDay, timeShift }) => {
            const trips = cache.get(wantedDay);
            if (!trips) return [];
            return [{ trips: stations ? filterTrips(trips, stations) : trips, timeShift }];
        });
        // `version` stands for the cache's contents changing
    }, [enabled, cache, index, wanted, filter, version]);

    return useMemo(
        () => shown.map(({ trips, timeShift }) => createTripsLayer(trips, minutes, timeShift)),
        [shown, minutes]
    );
}
